// An in-memory ledger that models the XRP Ledger rules Gate A depends on. It checks structure and keys,
// not signatures: the live Testnet run is the authority on cryptography. Time moves only when advance()
// is called, so tests control validation, expiry and lost responses exactly.
import { decode, hashes, type Wallet } from 'xrpl';

export const LSF_DISABLE_MASTER = 0x00100000;
export const LSF_DEFAULT_RIPPLE = 0x00800000;
const ASF_DISABLE_MASTER = 4;
const ASF_DEFAULT_RIPPLE = 8;
const BASE_FEE_DROPS = 10;
const START_INDEX = 5000;
const LEDGER_WINDOW = 20;
const FUNDING_DROPS = 100_000_000n;

export interface FakeLine {
  balance: number;
  limit: number;
}

export interface FakeAccount {
  readonly address: string;
  readonly publicKey: string;
  balance: bigint;
  sequence: number;
  ownerCount: number;
  flags: number;
  regularKey: string | null;
  signerList: { quorum: number; entries: { account: string; weight: number }[] } | null;
  readonly lines: Map<string, FakeLine>;
}

interface Issued {
  readonly currency: string;
  readonly issuer: string;
  readonly value: string;
}

interface TxShape {
  readonly TransactionType: string;
  readonly Account: string;
  readonly Sequence: number;
  readonly Fee: string;
  readonly LastLedgerSequence?: number;
  readonly SigningPubKey?: string;
  readonly Signers?: readonly {
    readonly Signer: { readonly Account: string; readonly SigningPubKey: string };
  }[];
  readonly Destination?: string;
  readonly Amount?: string | Issued;
  readonly LimitAmount?: Issued;
  readonly SignerQuorum?: number;
  readonly SignerEntries?: readonly {
    readonly SignerEntry: { readonly Account: string; readonly SignerWeight: number };
  }[];
  readonly SetFlag?: number;
}

interface OpenTx {
  readonly hash: string;
  readonly tx: TxShape;
}

type Delivered = string | Issued | undefined;

interface Validated {
  readonly engineResult: string;
  readonly ledgerIndex: number;
  readonly delivered: Delivered;
}

interface Applied {
  readonly engineResult: string;
  readonly delivered: Delivered;
}

export function lineKey(currency: string, issuer: string): string {
  return `${currency}|${issuer}`;
}

/** An error shaped like the library's rippled errors: the code is in data.error. */
export function rippledError(code: string): Error {
  return Object.assign(new Error(code), { data: { error: code } });
}

export class FakeLedger {
  private index = START_INDEX;
  private readonly accounts = new Map<string, FakeAccount>();
  private open: OpenTx[] = [];
  private readonly results = new Map<string, Validated>();
  private dropNextResponse = false;
  private refusing = false;
  private forcedNextResult: string | null = null;
  /** Keys registered before an account exists, so a payment can create it with the right key. */
  private readonly pendingKeys = new Map<string, string>();
  /** Every blob the ledger was offered, in order. Used to prove blobs are never re-signed. */
  readonly submitted: string[] = [];

  get validatedIndex(): number {
    return this.index;
  }

  account(address: string): FakeAccount | undefined {
    return this.accounts.get(address);
  }

  fund(wallet: Wallet): void {
    if (!this.accounts.has(wallet.address)) {
      this.accounts.set(wallet.address, {
        address: wallet.address,
        publicKey: wallet.publicKey,
        balance: FUNDING_DROPS,
        sequence: 1,
        ownerCount: 0,
        flags: 0,
        regularKey: null,
        signerList: null,
        lines: new Map(),
      });
    }
  }

  /** Registers a wallet's key so that a payment to its address can create the account, as the reserve funding does. */
  expect(wallet: Wallet): void {
    this.pendingKeys.set(wallet.address, wallet.publicKey);
  }

  /** The next submission applies normally but its response is lost (the caller sees an error). */
  loseNextResponse(): void {
    this.dropNextResponse = true;
  }

  /** While on, submissions never reach the network: the caller sees an error and nothing is recorded. */
  refuseSubmissions(on: boolean): void {
    this.refusing = on;
  }

  /** The next applied transaction gets this result instead of the real one (for failure tests). */
  forceNextResult(engineResult: string): void {
    this.forcedNextResult = engineResult;
  }

  setRegularKey(address: string, key: string): void {
    const account = this.accounts.get(address);
    if (account === undefined) {
      throw new Error('no such account');
    }
    account.regularKey = key;
  }

  validated(hash: string): Validated | undefined {
    return this.results.get(hash);
  }

  line(holder: string, currency: string, issuer: string): FakeLine | undefined {
    return this.accounts.get(holder)?.lines.get(lineKey(currency, issuer));
  }

  /** Validates every open transaction into the next ledger, then moves the index forward. */
  advance(): void {
    const next = this.index + 1;
    for (const entry of this.open) {
      if (entry.tx.LastLedgerSequence !== undefined && entry.tx.LastLedgerSequence < next) {
        continue;
      }
      const applied = this.apply(entry.tx);
      if (applied !== null) {
        this.results.set(entry.hash, {
          engineResult: applied.engineResult,
          ledgerIndex: next,
          delivered: applied.delivered,
        });
      }
    }
    this.open = [];
    this.index = next;
  }

  /** Preliminary checks at submit time, as rippled does before a transaction can be applied. */
  submit(blob: string): {
    engineResult: string;
    accepted: boolean;
    applied: boolean;
    hash: string;
  } {
    this.submitted.push(blob);
    if (this.refusing) {
      throw new Error('submission not relayed');
    }
    const hash = hashes.hashSignedTx(blob);
    if (this.open.some((entry) => entry.hash === hash)) {
      return { engineResult: 'tesSUCCESS', accepted: true, applied: true, hash };
    }
    const tx = decode(blob) as unknown as TxShape;
    const code = this.preliminary(tx);
    if (code !== 'tesSUCCESS') {
      return { engineResult: code, accepted: false, applied: false, hash };
    }
    this.open.push({ hash, tx });
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new Error('response lost');
    }
    return { engineResult: 'tesSUCCESS', accepted: true, applied: true, hash };
  }

  private preliminary(tx: TxShape): string {
    const account = this.accounts.get(tx.Account);
    if (account === undefined) {
      return 'terNO_ACCOUNT';
    }
    if (tx.Sequence > account.sequence) {
      return 'terPRE_SEQ';
    }
    if (tx.Sequence < account.sequence) {
      return 'tefPAST_SEQ';
    }
    if (tx.LastLedgerSequence !== undefined && tx.LastLedgerSequence < this.index + 1) {
      return 'tefMAX_LEDGER';
    }
    return this.authorise(account, tx);
  }

  private authorise(account: FakeAccount, tx: TxShape): string {
    if (tx.Signers !== undefined && tx.Signers.length > 0) {
      const list = account.signerList;
      if (list === null) {
        return 'tefNOT_MULTI_SIGNING';
      }
      let weight = 0;
      const seen = new Set<string>();
      for (const entry of tx.Signers) {
        const signer = entry.Signer;
        if (seen.has(signer.Account)) {
          return 'tefBAD_SIGNATURE';
        }
        seen.add(signer.Account);
        const listed = list.entries.find((candidate) => candidate.account === signer.Account);
        if (listed === undefined) {
          return 'tefBAD_SIGNATURE';
        }
        if (this.accounts.get(signer.Account)?.publicKey !== signer.SigningPubKey) {
          return 'tefBAD_SIGNATURE';
        }
        weight += listed.weight;
      }
      return weight >= list.quorum ? 'tesSUCCESS' : 'tefBAD_QUORUM';
    }
    if ((account.flags & LSF_DISABLE_MASTER) !== 0) {
      return 'tefMASTER_DISABLED';
    }
    return tx.SigningPubKey === account.publicKey ? 'tesSUCCESS' : 'tefBAD_AUTH';
  }

  /** Applies a validated transaction. Returns null when it cannot be applied at all (nothing is recorded). */
  private apply(tx: TxShape): Applied | null {
    const account = this.accounts.get(tx.Account);
    if (account?.sequence !== tx.Sequence) {
      return null;
    }
    const fee = BigInt(tx.Fee);
    if (account.balance < fee) {
      return null;
    }
    account.balance -= fee;
    account.sequence += 1;
    if (this.forcedNextResult !== null) {
      const forced = this.forcedNextResult;
      this.forcedNextResult = null;
      return { engineResult: forced, delivered: undefined };
    }
    switch (tx.TransactionType) {
      case 'Payment':
        return this.applyPayment(account, tx);
      case 'TrustSet':
        return this.applyTrustSet(account, tx);
      case 'SignerListSet':
        return this.applySignerListSet(account, tx);
      case 'AccountSet':
        return this.applyAccountSet(account, tx);
      default:
        return { engineResult: 'tecNOT_SUPPORTED', delivered: undefined };
    }
  }

  private applyPayment(account: FakeAccount, tx: TxShape): Applied {
    const destination = this.accounts.get(tx.Destination ?? '');
    if (typeof tx.Amount === 'string') {
      const drops = BigInt(tx.Amount);
      if (destination === undefined) {
        return this.createFromPayment(account, tx, drops);
      }
      if (account.balance < drops) {
        return { engineResult: 'tecUNFUNDED_PAYMENT', delivered: undefined };
      }
      account.balance -= drops;
      destination.balance += drops;
      return { engineResult: 'tesSUCCESS', delivered: tx.Amount };
    }
    if (tx.Amount === undefined || destination === undefined) {
      return { engineResult: 'tecNO_DST', delivered: undefined };
    }
    const amount = tx.Amount;
    const value = Number(amount.value);
    const key = lineKey(amount.currency, amount.issuer);
    const issuer = this.accounts.get(amount.issuer);
    if (issuer === undefined) {
      return { engineResult: 'tecNO_ISSUER', delivered: undefined };
    }
    if (tx.Account === amount.issuer) {
      const line = destination.lines.get(key);
      if (line === undefined) {
        return { engineResult: 'tecNO_LINE', delivered: undefined };
      }
      if (line.balance + value > line.limit) {
        return { engineResult: 'tecPATH_DRY', delivered: undefined };
      }
      line.balance += value;
      return { engineResult: 'tesSUCCESS', delivered: amount };
    }
    if (tx.Destination === amount.issuer) {
      const line = account.lines.get(key);
      if (line === undefined) {
        return { engineResult: 'tecUNFUNDED_PAYMENT', delivered: undefined };
      }
      if (line.balance < value) {
        return { engineResult: 'tecUNFUNDED_PAYMENT', delivered: undefined };
      }
      line.balance -= value;
      return { engineResult: 'tesSUCCESS', delivered: amount };
    }
    // Holder to holder: the issuer must allow rippling, and both trust lines must have room.
    const sourceLine = account.lines.get(key);
    const destinationLine = destination.lines.get(key);
    if ((issuer.flags & LSF_DEFAULT_RIPPLE) === 0) {
      return { engineResult: 'tecPATH_DRY', delivered: undefined };
    }
    if (sourceLine === undefined) {
      return { engineResult: 'tecPATH_DRY', delivered: undefined };
    }
    if (sourceLine.balance < value) {
      return { engineResult: 'tecPATH_DRY', delivered: undefined };
    }
    if (destinationLine === undefined) {
      return { engineResult: 'tecPATH_DRY', delivered: undefined };
    }
    if (destinationLine.balance + value > destinationLine.limit) {
      return { engineResult: 'tecPATH_DRY', delivered: undefined };
    }
    sourceLine.balance -= value;
    destinationLine.balance += value;
    return { engineResult: 'tesSUCCESS', delivered: amount };
  }

  /** A payment to an address not yet on the ledger creates it, as rippled does for amounts at or above the reserve. */
  private createFromPayment(sender: FakeAccount, tx: TxShape, drops: bigint): Applied {
    const address = tx.Destination ?? '';
    const publicKey = this.pendingKeys.get(address);
    if (publicKey === undefined || drops < 1_000_000n) {
      return { engineResult: 'tecNO_DST', delivered: undefined };
    }
    if (sender.balance < drops) {
      return { engineResult: 'tecUNFUNDED_PAYMENT', delivered: undefined };
    }
    sender.balance -= drops;
    this.accounts.set(address, {
      address,
      publicKey,
      balance: drops,
      sequence: 1,
      ownerCount: 0,
      flags: 0,
      regularKey: null,
      signerList: null,
      lines: new Map(),
    });
    return { engineResult: 'tesSUCCESS', delivered: tx.Amount };
  }

  private applyTrustSet(account: FakeAccount, tx: TxShape): Applied {
    const limit = tx.LimitAmount;
    if (limit === undefined) {
      return { engineResult: 'temBAD_LIMIT', delivered: undefined };
    }
    const key = lineKey(limit.currency, limit.issuer);
    const existing = account.lines.get(key);
    if (existing === undefined) {
      account.ownerCount += 1;
      account.lines.set(key, { balance: 0, limit: Number(limit.value) });
    } else {
      existing.limit = Number(limit.value);
    }
    return { engineResult: 'tesSUCCESS', delivered: undefined };
  }

  private applySignerListSet(account: FakeAccount, tx: TxShape): Applied {
    const hadList = account.signerList !== null;
    if (tx.SignerEntries === undefined || tx.SignerEntries.length === 0) {
      account.signerList = null;
      if (hadList) {
        account.ownerCount -= 1;
      }
      return { engineResult: 'tesSUCCESS', delivered: undefined };
    }
    account.signerList = {
      quorum: tx.SignerQuorum ?? 0,
      entries: tx.SignerEntries.map((entry) => ({
        account: entry.SignerEntry.Account,
        weight: entry.SignerEntry.SignerWeight,
      })),
    };
    if (!hadList) {
      account.ownerCount += 1;
    }
    return { engineResult: 'tesSUCCESS', delivered: undefined };
  }

  private applyAccountSet(account: FakeAccount, tx: TxShape): Applied {
    if (tx.SetFlag === ASF_DISABLE_MASTER) {
      if (account.signerList === null && account.regularKey === null) {
        return { engineResult: 'tecNO_ALTERNATIVE_KEY', delivered: undefined };
      }
      account.flags |= LSF_DISABLE_MASTER;
    }
    if (tx.SetFlag === ASF_DEFAULT_RIPPLE) {
      account.flags |= LSF_DEFAULT_RIPPLE;
    }
    return { engineResult: 'tesSUCCESS', delivered: undefined };
  }

  /** Reads for the adapter: account data, trust lines, transaction status and server information. */
  read(command: string, params: Readonly<Record<string, unknown>>): unknown {
    switch (command) {
      case 'server_info':
        return {
          result: {
            info: {
              network_id: 1,
              validated_ledger: {
                seq: this.index,
                base_fee_xrp: 0.00001,
                reserve_base_xrp: 1,
                reserve_inc_xrp: 0.2,
              },
            },
          },
        };
      case 'account_info': {
        const account = this.accounts.get(String(params['account']));
        if (account === undefined) {
          throw rippledError('actNotFound');
        }
        const signerLists =
          account.signerList === null
            ? []
            : [
                {
                  SignerQuorum: account.signerList.quorum,
                  SignerEntries: account.signerList.entries.map((entry) => ({
                    SignerEntry: { Account: entry.account, SignerWeight: entry.weight },
                  })),
                },
              ];
        return {
          result: {
            account_data: {
              Account: account.address,
              Balance: account.balance.toString(),
              Sequence: account.sequence,
              OwnerCount: account.ownerCount,
              Flags: account.flags,
              ...(account.regularKey === null ? {} : { RegularKey: account.regularKey }),
            },
            ...(params['signer_lists'] === true ? { signer_lists: signerLists } : {}),
          },
        };
      }
      case 'account_lines': {
        const account = this.accounts.get(String(params['account']));
        if (account === undefined) {
          throw rippledError('actNotFound');
        }
        const peer = params['peer'];
        const lines = [...account.lines.entries()]
          .map(([key, line]) => {
            const [currency = '', issuer = ''] = key.split('|');
            return {
              currency,
              account: issuer,
              balance: String(line.balance),
              limit: String(line.limit),
            };
          })
          .filter((line) => peer === undefined || line.account === peer);
        return { result: { lines } };
      }
      case 'tx': {
        const hash = String(params['transaction']);
        const validated = this.results.get(hash);
        if (validated !== undefined) {
          return {
            result: {
              validated: true,
              ledger_index: validated.ledgerIndex,
              meta: {
                TransactionResult: validated.engineResult,
                delivered_amount: validated.delivered ?? 'unavailable',
              },
            },
          };
        }
        if (this.open.some((entry) => entry.hash === hash)) {
          return { result: { validated: false } };
        }
        throw rippledError('txnNotFound');
      }
      default:
        throw new Error(`fake ledger does not implement ${command}`);
    }
  }

  /** Fills in Fee, Sequence and LastLedgerSequence as autofill does. */
  autofill(tx: Record<string, unknown>, signers: number): Record<string, unknown> {
    const account = this.accounts.get(String(tx['Account']));
    if (account === undefined) {
      throw rippledError('actNotFound');
    }
    return {
      ...tx,
      Sequence: account.sequence,
      Fee: String(BASE_FEE_DROPS * (1 + signers)),
      LastLedgerSequence: this.index + LEDGER_WINDOW,
    };
  }
}

/** A client for one endpoint. Two clients over one ledger model two endpoints that can fail separately. */
export class FakeClient {
  online = true;

  constructor(private readonly ledger: FakeLedger) {}

  private guard(): void {
    if (!this.online) {
      throw new Error('network unreachable');
    }
  }

  request(req: { readonly command: string } & Readonly<Record<string, unknown>>): Promise<unknown> {
    this.guard();
    return Promise.resolve(this.ledger.read(req.command, req));
  }

  autofill(tx: Record<string, unknown>, signers: number): Promise<Record<string, unknown>> {
    this.guard();
    return Promise.resolve(this.ledger.autofill(tx, signers));
  }

  submit(blob: string): Promise<{
    result: {
      engine_result: string;
      accepted: boolean;
      applied: boolean;
      tx_json: { hash: string };
    };
  }> {
    this.guard();
    const outcome = this.ledger.submit(blob);
    return Promise.resolve({
      result: {
        engine_result: outcome.engineResult,
        accepted: outcome.accepted,
        applied: outcome.applied,
        tx_json: { hash: outcome.hash },
      },
    });
  }

  fundWallet(wallet: Wallet): Promise<{ wallet: Wallet; balance: number }> {
    this.guard();
    this.ledger.fund(wallet);
    return Promise.resolve({ wallet, balance: 100 });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}
