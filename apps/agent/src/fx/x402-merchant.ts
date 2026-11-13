import express from 'express';
import { requirePayment } from 'x402-xrpl/express';

import { resolveUsdZarRate, type UsdZarRate } from '../../../../packages/shared/src/fx/index.js';

/**
 * The paid FX check, as a merchant: one USD/ZAR reference rate per request, for a fixed price in XRP. The price is
 * paid through the x402 flow, so the rate is served only after the payment is verified and settled. The rate source
 * is the same live reference rate the demo uses, and the merchant never serves a fixture as if it were live.
 */

/** The network the merchant accepts payment on. xrpl:1 is the XRPL Testnet. */
export const TESTNET_NETWORK = 'xrpl:1';

/** The path that serves the rate. */
export const RATE_PATH = '/fx/usd-zar';

export interface FxMerchantOptions {
  /** The classic address that receives the price. */
  readonly payTo: string;
  /** The hosted facilitator that verifies and settles the payment. */
  readonly facilitatorUrl: string;
  /** The price of one rate, in drops of XRP, as a decimal string. */
  readonly priceDrops: string;
  /** Where the rate comes from. Defaults to the live reference rate; tests replace it. */
  readonly rateSource?: () => Promise<UsdZarRate>;
}

/** An Express app that charges for one USD/ZAR rate. Start it with `listen`; it has no other routes. */
export function createFxMerchant(options: FxMerchantOptions): express.Express {
  if (!/^\d+$/.test(options.priceDrops) || options.priceDrops === '0') {
    throw new RangeError('the price is a positive whole number of drops');
  }
  const app = express();
  app.use(
    requirePayment({
      path: RATE_PATH,
      price: options.priceDrops,
      payToAddress: options.payTo,
      network: TESTNET_NETWORK,
      asset: 'XRP',
      facilitatorUrl: options.facilitatorUrl,
      resource: 'signoff:fx-usd-zar',
      description: 'One USD/ZAR reference rate, live from the ECB reference rate via Frankfurter',
      mimeType: 'application/json',
    }),
  );
  const rateSource = options.rateSource ?? (() => resolveUsdZarRate({ mode: 'live' }));
  app.get(RATE_PATH, (_request, response, next) => {
    rateSource().then(
      (rate) => {
        response.json({
          base: 'USD',
          quote: 'ZAR',
          rate: rate.rate,
          rateDate: rate.rateDate,
          source: rate.source,
          sourceKind: rate.sourceKind,
        });
      },
      (error: unknown) => {
        next(error);
      },
    );
  });
  return app;
}
