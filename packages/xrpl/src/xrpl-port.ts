import { Client, type SubmittableTransaction, type Wallet, xrpToDrops } from 'xrpl';
import { assertTestnetEndpoint, NetworkPolicyError, testnetEndpoints } from './network.js';
import { TESTNET_NETWORK_ID } from './constants.js';
import type { Delivered, LedgerLookup } from './reconcile.js';
import type {
  AccountSnapshot,
  LedgerPort,
  Reserves,
  SubmitOutcome,
  TokenRef,
  TrustLineSnapshot,
} from './port.js';
import type { SignerListView } from './signer-list.js';

interface ServerInfoResponse {
  readonly result: {
    readonly info: {
      readonly network_id?: number;
      readonly validated_ledger?: {
        readonly seq: number;
        readonly base_fee_xrp: number;
        readonly reserve_base_xrp: number;
        readonly reserve_inc_xrp: number;
      };
    };
  };
}

interface SignerListJson {
  readonly SignerQuorum: number;
  readonly SignerEntries: readonly {
    readonly SignerEntry: { readonly Account: string; readonly SignerWeight: number };
  }[];
}

interface AccountInfoResponse {
  readonly result: {
    readonly account_data: {
      readonly Account: string;
      readonly Balance: string;
      readonly Sequence: number;
      readonly OwnerCount: number;
      readonly Flags: number;
      readonly RegularKey?: string;
      readonly signer_lists?: readonly SignerListJson[];
    };
    readonly signer_lists?: readonly SignerListJson[];
  };
}

interface AccountLinesResponse {
  readonly result: {
    readonly lines: readonly {
      readonly currency: string;
      readonly balance: string;
      readonly limit: string;
      /** Set by the holder on its own line. */
      readonly freeze?: boolean;
      /** Set by the issuer on the holder's line. */
      readonly freeze_peer?: boolean;
    }[];
    readonly marker?: unknown;
  };
}

/** How the ledger reports a delivered amount: drops for XRP, an object for an issued currency. */
type DeliveredJson =
  | string
  | { readonly currency: string; readonly issuer: string; readonly value: string }
  | undefined;

interface TxResponse {
  readonly result: {
    readonly validated?: boolean;
    readonly ledger_index?: number;
    readonly meta?: {
      readonly TransactionResult: string;
      readonly delivered_amount?: DeliveredJson;
    };
  };
}

/** True when a rippled error carries the given error code, such as actNotFound or txnNotFound. */
function isRippledError(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return false;
  }
  const data: unknown = error.data;
  return typeof data === 'object' && data !== null && 'error' in data && data.error === code;
}

function deliveredOf(amount: DeliveredJson): Delivered {
  if (amount === undefined || amount === 'unavailable') {
    return { kind: 'unknown' };
  }
  if (typeof amount === 'string') {
    return { kind: 'xrp', drops: amount };
  }
  return {
    kind: 'iou',
    amount: { currency: amount.currency, issuer: amount.issuer, value: amount.value },
  };
}

function signerListOf(lists: readonly SignerListJson[] | undefined): SignerListView | null {
  const first = lists?.[0];
  if (first === undefined) {
    return null;
  }
  return {
    quorum: first.SignerQuorum,
    entries: first.SignerEntries.map((entry) => ({
      account: entry.SignerEntry.Account,
      weight: entry.SignerEntry.SignerWeight,
    })),
  };
}

/**
 * Adapts an xrpl.js client to the LedgerPort the orchestration uses. Every response is read through a
 * minimal shape, so a change in the library's typings cannot silently change what is read.
 */
export function createXrplPort(client: Client, endpoint: string): LedgerPort {
  async function serverInfo(): Promise<ServerInfoResponse['result']['info']> {
    const response = (await client.request({
      command: 'server_info',
    })) as unknown as ServerInfoResponse;
    return response.result.info;
  }

  async function validatedLedger(): Promise<
    NonNullable<ServerInfoResponse['result']['info']['validated_ledger']>
  > {
    const info = await serverInfo();
    if (info.validated_ledger === undefined) {
      throw new Error('the endpoint reports no validated ledger');
    }
    return info.validated_ledger;
  }

  return {
    endpoint,

    async networkId() {
      const info = await serverInfo();
      return info.network_id ?? -1;
    },

    async validatedLedgerIndex() {
      return (await validatedLedger()).seq;
    },

    async baseFeeDrops() {
      return xrpToDrops((await validatedLedger()).base_fee_xrp);
    },

    async reserves(): Promise<Reserves> {
      const ledger = await validatedLedger();
      return {
        baseDrops: xrpToDrops(ledger.reserve_base_xrp),
        incrementDrops: xrpToDrops(ledger.reserve_inc_xrp),
      };
    },

    async account(address: string): Promise<AccountSnapshot | null> {
      try {
        const response = (await client.request({
          command: 'account_info',
          account: address,
          ledger_index: 'validated',
          signer_lists: true,
        })) as unknown as AccountInfoResponse;
        const data = response.result.account_data;
        return {
          address: data.Account,
          balanceDrops: data.Balance,
          sequence: data.Sequence,
          ownerCount: data.OwnerCount,
          flags: data.Flags,
          regularKeyPresent: data.RegularKey !== undefined,
          signerList: signerListOf(data.signer_lists ?? response.result.signer_lists),
        };
      } catch (error) {
        if (isRippledError(error, 'actNotFound')) {
          return null;
        }
        throw error;
      }
    },

    async trustLine(holder: string, token: TokenRef): Promise<TrustLineSnapshot | null> {
      let marker: unknown;
      do {
        const request: {
          command: 'account_lines';
          account: string;
          peer: string;
          ledger_index: 'validated';
          marker?: unknown;
        } = {
          command: 'account_lines',
          account: holder,
          peer: token.issuer,
          ledger_index: 'validated',
        };
        if (marker !== undefined) {
          request.marker = marker;
        }
        const response = (await client.request(request)) as unknown as AccountLinesResponse;
        const line = response.result.lines.find(
          (candidate) => candidate.currency === token.currency,
        );
        if (line !== undefined) {
          return {
            balance: line.balance,
            limit: line.limit,
            frozenByIssuer: line.freeze_peer === true,
            frozenByHolder: line.freeze === true,
          };
        }
        marker = response.result.marker;
      } while (marker !== undefined);
      return null;
    },

    async autofill(
      transaction: SubmittableTransaction,
      signers: number,
    ): Promise<SubmittableTransaction> {
      return client.autofill(transaction, signers);
    },

    async submit(txBlob: string): Promise<SubmitOutcome> {
      const response = await client.submit(txBlob);
      return {
        engineResult: response.result.engine_result,
        accepted: response.result.accepted,
        applied: response.result.applied,
      };
    },

    async lookup(hash: string): Promise<LedgerLookup> {
      try {
        const response = (await client.request({
          command: 'tx',
          transaction: hash,
        })) as unknown as TxResponse;
        const result = response.result;
        if (
          result.validated !== true ||
          result.meta === undefined ||
          result.ledger_index === undefined
        ) {
          return { status: 'not-validated' };
        }
        return {
          status: 'validated',
          engineResult: result.meta.TransactionResult,
          ledgerIndex: result.ledger_index,
          delivered: deliveredOf(result.meta.delivered_amount),
        };
      } catch (error) {
        if (isRippledError(error, 'txnNotFound')) {
          return { status: 'not-validated' };
        }
        throw error;
      }
    },

    async fund(wallet: Wallet): Promise<void> {
      await client.fundWallet(wallet);
    },

    async disconnect(): Promise<void> {
      await client.disconnect();
    },
  };
}

/**
 * Connects to one testnet endpoint and confirms it is the testnet. Refuses any other network, and
 * closes the connection again if the check fails.
 */
export async function connectTestnetPort(rawEndpoint: string): Promise<LedgerPort> {
  const endpoint = assertTestnetEndpoint(rawEndpoint);
  const client = new Client(endpoint);
  await client.connect();
  const port = createXrplPort(client, endpoint);
  const networkId = await port.networkId();
  if (networkId !== TESTNET_NETWORK_ID) {
    await port.disconnect();
    throw new NetworkPolicyError('the endpoint does not report the testnet network ID');
  }
  return port;
}

/**
 * Tries the allow-listed endpoints in order and returns the first that answers as the testnet.
 * This is the failover entry point used by the CLI.
 */
export async function connectFirstAvailable(
  connect: (endpoint: string) => Promise<LedgerPort> = connectTestnetPort,
  endpoints: readonly string[] = testnetEndpoints(),
): Promise<LedgerPort> {
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      return await connect(endpoint);
    } catch (error) {
      failures.push(error instanceof Error ? error.name : 'error');
    }
  }
  throw new NetworkPolicyError(`no testnet endpoint answered (${failures.join(', ')})`);
}
