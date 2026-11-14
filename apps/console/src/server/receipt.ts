import { sameIouAmount } from '../../../../packages/xrpl/src/amounts.js';
import { RLUSD_TESTNET } from '../../../../packages/xrpl/src/constants.js';
import type { LedgerLookup } from '../../../../packages/xrpl/src/reconcile.js';
import {
  minorToDecimal,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../../../../packages/shared/src/money/minor-units.js';
import { type DisplayState } from '../model/desk.js';

/**
 * The receipt for a paid payment. It is shown only when the desk says Paid, and it re-reads the transaction from the
 * ledger before it says so. Any doubt (no full hash, an unreachable ledger, a result that is not a validated success, a
 * delivered amount that differs from the settled record) is shown as Not confirmed on the ledger, never as a receipt.
 */

/** The explorer for the Testnet. The link is built from a full transaction hash and this fixed base, and from nothing else. */
export const TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions/';

const FULL_HASH = /^[0-9A-Fa-f]{64}$/;
const TEST_TOKEN_LABEL = 'test-issued token, not RLUSD';
const VALIDATED_RESULT = 'tesSUCCESS';

/** The one read the receipt needs from the ledger: a transaction by its hash. */
export interface ReceiptLedger {
  lookup(hash: string): Promise<LedgerLookup>;
}

export interface ReceiptConfig {
  /** The issuer of the test-issued token. Without it no receipt can be confirmed. */
  readonly tokenIssuer: string | null;
  /** The RLUSD issuer, when RLUSD is configured. The asset is named RLUSD only when it matches the token issuer. */
  readonly rlusdIssuer: string | null;
  /** The explorer's transaction address, ending in a slash. */
  readonly explorerBase: string;
  /** A placeholder rate for the SIMULATED rand figure, as a decimal such as 18.50. Null shows no rand figure. */
  readonly demoRandPerUnit: string | null;
}

/** The payment fields a receipt uses, from the Warden's view. */
export interface ReceiptPayment {
  readonly status: string;
  readonly currency: string;
  readonly ledgerCurrency?: string | undefined;
  readonly amountMinor: number;
  readonly transactionHash: string | null;
}

/** A rand figure. It is always labelled SIMULATED, and it uses a placeholder rate, never a market rate. */
export interface RandFigure {
  readonly label: 'SIMULATED';
  readonly amount: string;
  readonly rate: string;
}

export type ReceiptView =
  | { readonly state: 'not-paid'; readonly message: string }
  | { readonly state: 'not-confirmed'; readonly message: string }
  | {
      readonly state: 'receipt';
      readonly invoiceRef: string;
      readonly amount: string;
      readonly currency: string;
      readonly asset: string;
      readonly deliveredValue: string;
      readonly ledgerIndex: number;
      readonly explorerUrl: string;
      readonly rand: RandFigure | null;
    };

function notConfirmed(message: string): ReceiptView {
  return { state: 'not-confirmed', message: `Not confirmed on the ledger: ${message}` };
}

function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** The asset's name, decided from configuration. RLUSD only when its issuer is the token's issuer; otherwise the test token. */
export function assetLabelOf(config: ReceiptConfig, ledgerCurrency: string): string {
  if (
    config.rlusdIssuer !== null &&
    config.rlusdIssuer === config.tokenIssuer &&
    // The ledger carries RLUSD as its 40-character hex code (constants.ts), not as the word RLUSD.
    (ledgerCurrency === 'RLUSD' || ledgerCurrency === RLUSD_TESTNET.currency)
  ) {
    return 'RLUSD';
  }
  return TEST_TOKEN_LABEL;
}

function randOf(value: string, config: ReceiptConfig): RandFigure | null {
  if (config.demoRandPerUnit === null) {
    return null;
  }
  const amount = (Number(value) * Number(config.demoRandPerUnit)).toFixed(2);
  return { label: 'SIMULATED', amount, rate: config.demoRandPerUnit };
}

/** The receipt for one invoice. It asks the ledger only when the desk says the payment is paid. */
export async function receiptOf(input: {
  readonly displayState: DisplayState;
  readonly invoiceRef: string;
  readonly payment: ReceiptPayment | null;
  readonly ledger: ReceiptLedger | null;
  readonly config: ReceiptConfig;
}): Promise<ReceiptView> {
  const { payment, config } = input;
  if (input.displayState !== 'Paid' || payment === null) {
    return { state: 'not-paid', message: 'This payment is not paid, so there is no receipt.' };
  }
  const hash = payment.transactionHash;
  if (hash === null || !FULL_HASH.test(hash)) {
    return notConfirmed('no full transaction hash is recorded for this payment.');
  }
  if (input.ledger === null) {
    return notConfirmed('no ledger is configured.');
  }
  if (config.tokenIssuer === null) {
    return notConfirmed('the token issuer is not configured.');
  }
  if (!isSupportedCurrency(payment.currency) || payment.ledgerCurrency === undefined) {
    return notConfirmed('the currency of this payment is not recognised.');
  }
  const ledgerCurrency = payment.ledgerCurrency;
  let lookup: LedgerLookup;
  try {
    lookup = await input.ledger.lookup(hash);
  } catch {
    return notConfirmed('the ledger could not be read.');
  }
  if (lookup.status !== 'validated') {
    return notConfirmed('the transaction is not validated yet.');
  }
  if (lookup.engineResult !== VALIDATED_RESULT) {
    return notConfirmed(`the ledger result is ${lookup.engineResult}.`);
  }
  const expected = {
    currency: ledgerCurrency,
    issuer: config.tokenIssuer,
    value: minorToDecimal(payment.amountMinor, payment.currency),
  };
  if (lookup.delivered.kind !== 'iou' || !sameIouAmount(expected, lookup.delivered.amount)) {
    return notConfirmed('the delivered amount does not match the settled record.');
  }
  return {
    state: 'receipt',
    invoiceRef: input.invoiceRef,
    amount: expected.value,
    currency: payment.currency,
    asset: assetLabelOf(config, ledgerCurrency),
    deliveredValue: lookup.delivered.amount.value,
    ledgerIndex: lookup.ledgerIndex,
    explorerUrl: `${config.explorerBase}${hash}`,
    rand: randOf(expected.value, config),
  };
}
