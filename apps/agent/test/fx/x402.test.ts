import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createFxMerchant, RATE_PATH } from '../../src/fx/x402-merchant.js';
import { parsePaidRate } from '../../src/fx/x402-rate.js';

/*
 * The paid FX check, tested without the network: the merchant must refuse a request that carries no payment, and
 * name the price, the payee and the network in its 402 answer. A paid end-to-end run is a separate, approved step.
 */

const PAY_TO = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((closed) => {
          server.close(() => {
            closed();
          });
        }),
    ),
  );
});

async function listen(app: ReturnType<typeof createFxMerchant>): Promise<string> {
  const server = await new Promise<Server>((ready) => {
    const started = app.listen(0, '127.0.0.1', () => {
      ready(started);
    });
  });
  servers.push(server);
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

describe('the paid FX merchant', () => {
  it('answers a request with no payment with 402 and names the price, the payee and the network', async () => {
    const base = await listen(
      createFxMerchant({
        payTo: PAY_TO,
        facilitatorUrl: 'http://127.0.0.1:9',
        priceDrops: '10000',
        rateSource: () => Promise.reject(new Error('must not be called without a payment')),
      }),
    );
    const response = await fetch(`${base}${RATE_PATH}`);
    expect(response.status).toBe(402);
    const text = await response.text();
    expect(text).toContain(PAY_TO);
    expect(text).toContain('xrpl:1');
    expect(text).toContain('10000');
  });

  it('refuses a price that is not a positive whole number of drops', () => {
    expect(() =>
      createFxMerchant({ payTo: PAY_TO, facilitatorUrl: 'http://127.0.0.1:9', priceDrops: '0' }),
    ).toThrow(RangeError);
    expect(() =>
      createFxMerchant({ payTo: PAY_TO, facilitatorUrl: 'http://127.0.0.1:9', priceDrops: '1.5' }),
    ).toThrow(RangeError);
  });
});

describe('the paid rate the agent accepts', () => {
  const good = {
    base: 'USD',
    quote: 'ZAR',
    rate: '16.715',
    rateDate: '2026-11-12',
    source: 'ECB reference rate via Frankfurter',
    sourceKind: 'live',
  };

  it('accepts the shape the merchant serves', () => {
    expect(parsePaidRate(good).rate).toBe('16.715');
  });

  it('refuses a rate with extra fields, a wrong pair, or a malformed rate', () => {
    expect(() => parsePaidRate({ ...good, extra: 'x' })).toThrow();
    expect(() => parsePaidRate({ ...good, quote: 'EUR' })).toThrow();
    expect(() => parsePaidRate({ ...good, rate: '16,715' })).toThrow();
    expect(() => parsePaidRate({ ...good, rateDate: '12/11/2026' })).toThrow();
  });
});
