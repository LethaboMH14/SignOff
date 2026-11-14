import { describe, expect, it } from 'vitest';

import { onRampQuote, paystackTestPayout, RampError, simulatedPayout } from './ramp.js';

function fakePaystack(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; method: string; body: unknown; auth: string }[] = [];
  const fetchFn = ((
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : (JSON.parse(init.body) as unknown),
      auth: init?.headers?.['Authorization'] ?? '',
    });
    const reply = replies.shift() ?? { status: 500, body: { status: false } };
    return Promise.resolve({
      ok: reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const RECIPIENT = { name: 'Fictional Wholesale (Pty) Ltd', accountNumber: '0000000000' };

describe('local money in and out', () => {
  it('labels the on-ramp as simulated with an illustrative rate', () => {
    const quote = onRampQuote(6000, 'INV-1');
    expect(quote.zmwMinor).toBe(8700);
    expect(quote.text).toContain('simulated');
    expect(quote.text).toContain('illustrative');
  });

  it('simulates the payout when no test key is set', async () => {
    const result = await simulatedPayout().pay({ invoiceNumber: 'INV-1', amountZarMinor: 6000 });
    expect(result.provider).toBe('simulated');
    expect(result.text).toContain('R60.00');
  });

  it('refuses a live Paystack key', () => {
    expect(() =>
      paystackTestPayout({ secretKey: 'sk_live_x', recipient: { ...RECIPIENT, bankCode: '1' } }),
    ).toThrow(RampError);
  });

  it('makes a test-mode transfer to a South African bank recipient in rand cents', async () => {
    const { fetchFn, calls } = fakePaystack([
      { status: 200, body: { status: true, data: [{ code: '632005' }] } },
      { status: 201, body: { status: true, data: { recipient_code: 'RCP_1' } } },
      { status: 200, body: { status: true, data: { status: 'success', transfer_code: 'TRF_1' } } },
    ]);
    const rail = paystackTestPayout({
      secretKey: 'sk_test_x',
      recipient: { ...RECIPIENT, bankCode: null },
      fetchFn,
    });
    const result = await rail.pay({ invoiceNumber: 'INV-DEMO-1', amountZarMinor: 6000 });
    expect(result.provider).toBe('paystack-test');
    expect(result.text).toContain('TEST-MODE');
    expect(calls[1]?.body).toMatchObject({ type: 'basa', currency: 'ZAR', bank_code: '632005' });
    expect(calls[2]?.body).toMatchObject({
      amount: 6000,
      currency: 'ZAR',
      recipient: 'RCP_1',
      source: 'balance',
    });
    expect(calls.every((call) => call.auth === 'Bearer sk_test_x')).toBe(true);
  });

  it('reuses the recipient for later payouts', async () => {
    const { fetchFn, calls } = fakePaystack([
      { status: 201, body: { status: true, data: { recipient_code: 'RCP_1' } } },
      { status: 200, body: { status: true, data: { status: 'success' } } },
      { status: 200, body: { status: true, data: { status: 'success' } } },
    ]);
    const rail = paystackTestPayout({
      secretKey: 'sk_test_x',
      recipient: { ...RECIPIENT, bankCode: '1' },
      fetchFn,
    });
    await rail.pay({ invoiceNumber: 'A', amountZarMinor: 100 });
    await rail.pay({ invoiceNumber: 'B', amountZarMinor: 100 });
    expect(calls.filter((call) => call.url.endsWith('/transferrecipient'))).toHaveLength(1);
  });

  it('reports a Paystack refusal without the key', async () => {
    const { fetchFn } = fakePaystack([{ status: 401, body: { status: false } }]);
    const rail = paystackTestPayout({
      secretKey: 'sk_test_secret',
      recipient: { ...RECIPIENT, bankCode: '1' },
      fetchFn,
    });
    const error = await rail
      .pay({ invoiceNumber: 'A', amountZarMinor: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RampError);
    expect(String(error)).not.toContain('sk_test_secret');
  });
});
