// Testnet RLUSD funding and read-only status. Testnet only: connections go through the allow-listed
// endpoints, and the registry lives outside the repository. Output holds roles, balances, ledger indexes,
// flags, offer amounts and transaction hashes; no addresses and no seeds are printed.
// Usage:
//   npm run testnet:funds -- status
//   npm run testnet:funds -- buy --rlusd 10 --max-xrp-per-rlusd 3 [--confirm]
// `buy` places one immediate-or-cancel offer from the reserve account (XRP for RLUSD) on the Testnet DEX and,
// with --confirm, sends the RLUSD it received to the spending account. Without --confirm it only reads the
// book and reports what it would do. Nothing is sent unless the offer's total cost is within the cap.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Wallet, dropsToXrp } from 'xrpl';
import type { Registry } from '../../packages/xrpl/src/index.js';
import {
  connectFirstAvailable,
  LSF_DISABLE_MASTER,
  RLUSD_TESTNET,
  requireAccount,
  testnetEndpoints,
  type LedgerPort,
} from '../../packages/xrpl/src/index.js';
import {
  assertOutsideRepository,
  defaultLocalDir,
  fileRegistryStore,
} from '../../packages/xrpl/src/node.js';

const LSF = {
  requireDestTag: 0x00020000,
  requireAuth: 0x00040000,
  disallowXrp: 0x00080000,
  globalFreeze: 0x00400000,
  defaultRipple: 0x00800000,
  allowTrustLineLocking: 0x40000000,
} as const;

const TF_IMMEDIATE_OR_CANCEL = 0x00020000;

/** Names the account flags that matter for a payment, from the ledger's AccountRoot flags. */
export function describeFlags(flags: number): string[] {
  const names: [string, number][] = [
    ['lsfRequireDestTag', LSF.requireDestTag],
    ['lsfRequireAuth', LSF.requireAuth],
    ['lsfDisallowXRP', LSF.disallowXrp],
    ['lsfGlobalFreeze', LSF.globalFreeze],
    ['lsfDefaultRipple', LSF.defaultRipple],
    ['lsfAllowTrustLineLocking', LSF.allowTrustLineLocking],
    ['lsfDisableMaster', LSF_DISABLE_MASTER],
  ];
  return names.filter(([, bit]) => (flags & bit) !== 0).map(([name]) => name);
}

interface BookLevel {
  readonly xrp: number;
  readonly rlusd: number;
  readonly pricePerRlusd: number;
}

/**
 * Reads the sell side of the Testnet DEX: offers whose owners give RLUSD and want XRP. Those are the offers a
 * buyer's XRP-for-RLUSD offer crosses. Best price (lowest XRP per RLUSD) first.
 */
async function readBook(client: Client): Promise<BookLevel[]> {
  const response = (await client.request({
    command: 'book_offers',
    taker_gets: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer },
    taker_pays: { currency: 'XRP' },
    limit: 50,
  })) as unknown as {
    result: {
      offers: {
        TakerGets: { value: string } | string;
        TakerPays: string | { value: string };
        owner_funds?: string;
      }[];
    };
  };
  const levels: BookLevel[] = [];
  for (const offer of response.result.offers) {
    const gets = offer.TakerGets;
    const pays = offer.TakerPays;
    if (typeof gets === 'string' || typeof pays !== 'string') {
      continue;
    }
    const xrp = dropsToXrp(pays);
    const rlusd = Number(gets.value);
    if (xrp > 0 && rlusd > 0) {
      levels.push({ xrp, rlusd, pricePerRlusd: xrp / rlusd });
    }
  }
  return levels.sort((a, b) => a.pricePerRlusd - b.pricePerRlusd);
}

/** Cumulative RLUSD available at or below a maximum XRP price per RLUSD. */
export function depthBelow(levels: readonly BookLevel[], maxXrpPerRlusd: number): number {
  return levels
    .filter((level) => level.pricePerRlusd <= maxXrpPerRlusd)
    .reduce((sum, level) => sum + level.rlusd, 0);
}

/** The RLUSD balance on an account's trust line, or '0' when it has no line. */
async function balanceOf(port: LedgerPort, address: string): Promise<string> {
  const line = await port.trustLine(address, {
    currency: RLUSD_TESTNET.currency,
    issuer: RLUSD_TESTNET.issuer,
  });
  return line === null ? '0' : line.balance;
}

async function status(port: LedgerPort, client: Client): Promise<unknown> {
  const dir = defaultLocalDir();
  const registry = await fileRegistryStore(join(dir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run the provision step first');
  }
  const spending = requireAccount(registry, 'spending');
  const reserve = requireAccount(registry, 'reserve');
  const supplier = requireAccount(registry, 'supplier');
  // The RLUSD issuer is Ripple's Testnet account, not the registry's test-token issuer.
  const issuerState = await port.account(RLUSD_TESTNET.issuer);
  const ledger = await port.validatedLedgerIndex();
  const reserveState = await port.account(reserve.address);
  const supplierState = await port.account(supplier.address);
  const spendingState = await port.account(spending.address);
  const book = await readBook(client);
  const spendingRlusd = await balanceOf(port, spending.address);
  const reserveRlusd = await balanceOf(port, reserve.address);
  const supplierRlusd = await balanceOf(port, supplier.address);
  return {
    endpoint: port.endpoint,
    validatedLedger: ledger,
    issuer: {
      account: 'RLUSD Testnet issuer (constants.ts)',
      flags: issuerState ? describeFlags(issuerState.flags) : 'not on ledger',
    },
    spending: {
      rlusd: spendingRlusd,
      xrpDrops: spendingState?.balanceDrops ?? null,
      flags: spendingState ? describeFlags(spendingState.flags) : 'not on ledger',
    },
    reserve: {
      rlusd: reserveRlusd,
      xrpDrops: reserveState?.balanceDrops ?? null,
    },
    supplier: {
      rlusd: supplierRlusd,
      flags: supplierState ? describeFlags(supplierState.flags) : 'not on ledger',
    },
    dex: {
      offers: book.length,
      rlusdAvailableAtMost3XrpPerRlusd: depthBelow(book, 3).toFixed(6),
      rlusdAvailableAtMost6XrpPerRlusd: depthBelow(book, 6).toFixed(6),
      bestPriceXrpPerRlusd: book[0]?.pricePerRlusd ?? null,
      rlusdAvailableAnyPrice: book.reduce((sum, level) => sum + level.rlusd, 0).toFixed(6),
      levels: book.slice(0, 10).map((level) => ({
        rlusd: level.rlusd,
        xrp: level.xrp,
        pricePerRlusd: level.pricePerRlusd,
      })),
    },
  };
}

interface BuyPlan {
  readonly rlusd: string;
  readonly maxXrpPerRlusd: number;
  readonly levelsUsed: number;
}

/** Works out whether the book can fill the wanted RLUSD under the price cap, without sending anything. */
export function planBuy(
  levels: readonly BookLevel[],
  wantRlusd: number,
  maxXrpPerRlusd: number,
): BuyPlan | null {
  let filled = 0;
  let used = 0;
  for (const level of levels) {
    if (level.pricePerRlusd > maxXrpPerRlusd || filled >= wantRlusd) {
      break;
    }
    filled += level.rlusd;
    used += 1;
  }
  if (filled < wantRlusd) {
    return null;
  }
  return { rlusd: wantRlusd.toFixed(6), maxXrpPerRlusd, levelsUsed: used };
}

async function buy(port: LedgerPort, client: Client, args: readonly string[]): Promise<unknown> {
  const wantIdx = args.indexOf('--rlusd');
  const capIdx = args.indexOf('--max-xrp-per-rlusd');
  const want = wantIdx >= 0 ? Number(args[wantIdx + 1]) : Number.NaN;
  const cap = capIdx >= 0 ? Number(args[capIdx + 1]) : Number.NaN;
  if (!(want > 0) || !(cap > 0)) {
    throw new Error('buy needs --rlusd <positive amount> and --max-xrp-per-rlusd <positive price>');
  }
  const confirm = args.includes('--confirm');
  const dir = defaultLocalDir();
  const registry = await fileRegistryStore(join(dir, 'registry.json')).read();
  if (registry === null) {
    throw new Error('no registry; run the provision step first');
  }
  const spending = requireAccount(registry, 'spending');
  const reserve = requireAccount(registry, 'reserve');
  const book = await readBook(client);
  const plan = planBuy(book, want, cap);
  if (plan === null) {
    return {
      action: 'refused',
      reason: 'the Testnet DEX does not hold that much RLUSD under the price cap; nothing was sent',
      wantedRlusd: want,
      availableUnderCap: depthBelow(book, cap).toFixed(6),
    };
  }
  const maxXrpDrops = Math.ceil(want * cap * 1_000_000).toString();
  if (!confirm) {
    return { action: 'dry-run', plan, maxXrpDrops, note: 'add --confirm to place the offer' };
  }
  const reserveWallet = Wallet.fromSeed(requireSeed(registry, 'reserve'));
  const before = await balanceOf(port, reserve.address);
  const offer = {
    TransactionType: 'OfferCreate' as const,
    Account: reserve.address,
    TakerGets: maxXrpDrops,
    TakerPays: {
      currency: RLUSD_TESTNET.currency,
      issuer: RLUSD_TESTNET.issuer,
      value: want.toFixed(6),
    },
    Flags: TF_IMMEDIATE_OR_CANCEL,
  };
  const prepared = await port.autofill(offer, 1);
  const signed = reserveWallet.sign(prepared);
  const offerOutcome = await port.submit(signed.tx_blob);
  if (offerOutcome.engineResult !== 'tesSUCCESS') {
    return { action: 'offer-not-applied', engineResult: offerOutcome.engineResult };
  }
  const offerLedger = await waitValidated(port, signed.hash);
  const gained = await balanceOf(port, reserve.address);
  const received = subtractDecimal(gained, before);
  if (received === null || Number(received) <= 0) {
    return { action: 'offer-validated-no-rlusd', offerHash: signed.hash, offerLedger };
  }
  const payment = {
    TransactionType: 'Payment' as const,
    Account: reserve.address,
    Destination: spending.address,
    Amount: { currency: RLUSD_TESTNET.currency, issuer: RLUSD_TESTNET.issuer, value: received },
  };
  const paid = reserveWallet.sign(await port.autofill(payment, 1));
  const paymentOutcome = await port.submit(paid.tx_blob);
  const paymentLedger =
    paymentOutcome.engineResult === 'tesSUCCESS' ? await waitValidated(port, paid.hash) : null;
  return {
    action: paymentLedger === null ? 'payment-not-applied' : 'bought-and-sent',
    offerHash: signed.hash,
    offerLedger,
    rlusdReceivedByReserve: received,
    paymentHash: paid.hash,
    paymentEngineResult: paymentOutcome.engineResult,
    paymentLedger,
    spendingRlusdAfter: await balanceOf(port, spending.address),
  };
}

/** Waits until the transaction is validated, and returns its ledger index. Fails if it is not in time. */
async function waitValidated(port: LedgerPort, hash: string): Promise<number> {
  for (let poll = 0; poll < 30; poll += 1) {
    const lookup = await port.lookup(hash);
    if (lookup.status === 'validated') {
      if (lookup.engineResult !== 'tesSUCCESS') {
        throw new Error(`transaction ${hash} validated with ${lookup.engineResult}`);
      }
      return lookup.ledgerIndex;
    }
    await new Promise((done) => {
      setTimeout(done, 2000);
    });
  }
  throw new Error(`transaction ${hash} was not validated within 60 seconds`);
}

/** Plain decimal text only: an optional sign, then digits with at most one fraction part. */
function isPlainDecimal(text: string): boolean {
  const unsigned = text.startsWith('-') ? text.slice(1) : text;
  const parts = unsigned.split('.');
  return parts.length <= 2 && parts.every((part) => /^[0-9]+$/.test(part));
}

/** Exact decimal subtraction for the RLUSD balance change. Returns null when a value is not a decimal. */
export function subtractDecimal(a: string, b: string): string | null {
  if (!isPlainDecimal(a) || !isPlainDecimal(b)) {
    return null;
  }
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length);
  const scaled = (value: string): bigint => {
    const [whole = '0', frac = ''] = value.split('.');
    return BigInt(whole + frac.padEnd(scale, '0'));
  };
  const diff = scaled(a) - scaled(b);
  const negative = diff < 0n;
  const digits = (negative ? -diff : diff).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${frac}` : ''}`;
}

function requireSeed(registry: Registry, role: string): string {
  const account = registry.accounts.find(
    (entry) => entry.role === role && entry.seed !== undefined,
  );
  if (account?.seed === undefined) {
    throw new Error(`the ${role} account has no seed in the local registry`);
  }
  return account.seed;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  if (command !== 'status' && command !== 'buy') {
    process.stderr.write('usage: funds <status|buy> [options]\n');
    process.exitCode = 2;
    return;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assertOutsideRepository(defaultLocalDir(), repoRoot);
  const port = await connectFirstAvailable();
  const client = new Client(port.endpoint);
  await client.connect();
  try {
    const result =
      command === 'status'
        ? await status(port, client)
        : await buy(port, client, process.argv.slice(3));
    process.stdout.write(
      `${JSON.stringify({ command, endpoints: testnetEndpoints().length, result }, null, 2)}\n`,
    );
  } finally {
    await client.disconnect();
    await port.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
