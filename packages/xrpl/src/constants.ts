// Ledger constants used by SignOff. Changing a value is a decision: record it in the decision journal first.

/** The Testnet network ID reported by server_info. Mainnet is 0. */
export const TESTNET_NETWORK_ID = 1;

/**
 * The only endpoints the Gate A tooling may connect to. The first is the primary, the second the
 * fallback used for failover. Anything else is refused before a socket is opened.
 */
export const TESTNET_ENDPOINTS: readonly string[] = [
  'wss://s.altnet.rippletest.net:51233',
  'wss://testnet.xrpl-labs.com',
];

/** Ripple USD on the XRP Ledger Testnet, from Ripple's developer documentation. Testnet tokens have no value. */
export const RLUSD_TESTNET = {
  label: 'RLUSD (XRP Ledger Testnet)',
  currency: '524C555344000000000000000000000000000000',
  issuer: 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
} as const;

/** Currency code of the test-issued token, used while RLUSD testnet balances are not available. */
export const TEST_TOKEN_CURRENCY = 'TST';

/** Two of the two signers must approve a payment: Agent weight 1 + Warden weight 1 reach quorum 2. */
export const SIGNER_QUORUM = 2;
export const AGENT_SIGNER_WEIGHT = 1;
export const WARDEN_SIGNER_WEIGHT = 1;

/** AccountSet SetFlag values. */
export const ASF_DISABLE_MASTER = 4;
export const ASF_DEFAULT_RIPPLE = 8;

/** AccountRoot Flags bits. */
export const LSF_DISABLE_MASTER = 0x00100000;
export const LSF_DEFAULT_RIPPLE = 0x00800000;

/** Issued-currency values carry at most this many significant digits on the ledger. */
export const IOU_MAX_SIGNIFICANT_DIGITS = 15;

/** Trust-line limits for test accounts. A limit is an exposure layer, not a loss cap (D-005). */
export const TRUST_LIMIT_RLUSD = '100000';
export const TRUST_LIMIT_TEST_TOKEN = '1000000';

/** Test-token amount the issuer places in the spending account when it runs low. */
export const TEST_TOKEN_TOPUP = '1000';
export const TEST_TOKEN_LOW_WATER = '200';

/** Ledgers to wait beyond the transaction's LastLedgerSequence before a result is final (safety margin). */
export const LEDGER_SAFETY_MARGIN = 2;
