import type { Wallet } from 'xrpl';
import { x402Fetch } from 'x402-xrpl';
import { z } from 'zod';

import { TESTNET_NETWORK } from './x402-merchant.js';

/**
 * The agent's side of the paid FX check. The agent holds its own wallet, so it signs the x402 payment itself: one small
 * XRPL Payment for the merchant's price. The rate is accepted only in the shape the merchant serves.
 */

/** Plain decimal text: digits, with at most one dot that has digits on both sides. No sign, no exponent. */
function isDecimalText(value: string): boolean {
  const parts = value.split('.');
  return parts.length <= 2 && parts.every((part) => part.length > 0 && /^[0-9]+$/.test(part));
}

export const PaidRate = z.strictObject({
  base: z.literal('USD'),
  quote: z.literal('ZAR'),
  rate: z.string().max(20).refine(isDecimalText, 'a rate is plain decimal text, such as 16.715'),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(200),
  sourceKind: z.enum(['live', 'fixture']),
});
export type PaidRate = z.infer<typeof PaidRate>;

/** Checks the merchant's answer. Anything else is refused rather than used as a rate. */
export function parsePaidRate(body: unknown): PaidRate {
  return PaidRate.parse(body);
}

export interface PaidRateResult {
  readonly rate: PaidRate;
  readonly status: number;
  /** The merchant's settlement receipt, when it sends one, as the x402 header carries it. */
  readonly paymentResponse: string | null;
}

/**
 * Buys one rate. The payment is signed with the agent's own wallet, and the request is refused unless the merchant
 * answers 200 with a rate of the expected shape. A fixture rate is returned as the merchant reports it: the caller
 * decides whether a fixture is acceptable for its purpose.
 */
export async function fetchPaidRate(options: {
  readonly url: string;
  readonly wallet: Wallet;
}): Promise<PaidRateResult> {
  const paid = x402Fetch({
    wallet: options.wallet,
    network: TESTNET_NETWORK,
  });
  const response = await paid(options.url);
  if (response.status !== 200) {
    throw new Error(`the rate request returned HTTP ${String(response.status)}, not a rate`);
  }
  const rate = parsePaidRate(await response.json());
  return {
    rate,
    status: response.status,
    paymentResponse: response.headers.get('PAYMENT-RESPONSE'),
  };
}
