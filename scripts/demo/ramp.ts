// Local money in and out around the RLUSD payment. On Testnet both legs are SIMULATED:
// - On-ramp: the buyer's kwacha is shown converted at an illustrative rate. No money moves; the RLUSD comes from the
//   Testnet float the project already holds.
// - Off-ramp: the supplier's rand payout. With a Paystack TEST key (sk_test_...) it is a real Paystack test-mode
//   transfer, which moves no money and always succeeds; without one it is simulated locally. A live key is refused.
// In production a licensed partner (for example Yellow Card, an RLUSD distributor with ZAR and ZMW coverage) runs both
// legs; SignOff never holds fiat. Nothing here prints a key.

/** Illustrative kwacha per rand, for display only. Not a live rate. */
export const ILLUSTRATIVE_ZMW_PER_ZAR = 1.45;

export interface OnRampQuote {
  readonly zmwMinor: number;
  readonly text: string;
}

/** The buyer's side, simulated: how much kwacha the rand invoice stands for at the illustrative rate. */
export function onRampQuote(zarMinor: number, invoiceNumber: string): OnRampQuote {
  const zmwMinor = Math.round(zarMinor * ILLUSTRATIVE_ZMW_PER_ZAR);
  return {
    zmwMinor,
    text: `Buyer funding for ${invoiceNumber}: about ZMW ${(zmwMinor / 100).toFixed(2)} in, Testnet RLUSD out (simulated, illustrative rate; no money moved).`,
  };
}

export interface PayoutRequest {
  readonly invoiceNumber: string;
  readonly amountZarMinor: number;
}

export interface PayoutResult {
  readonly provider: 'paystack-test' | 'simulated';
  readonly reference: string;
  readonly status: string;
  readonly text: string;
}

export interface PayoutRail {
  pay(request: PayoutRequest): Promise<PayoutResult>;
}

/** A local stand-in when no Paystack test key is set. */
export function simulatedPayout(): PayoutRail {
  return {
    pay(request) {
      const reference = `SIM-${request.invoiceNumber}`;
      return Promise.resolve({
        provider: 'simulated',
        reference,
        status: 'success',
        text: `Supplier payout for ${request.invoiceNumber}: R${(request.amountZarMinor / 100).toFixed(2)} (simulated; reference ${reference}).`,
      });
    },
  };
}

export class RampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RampError';
  }
}

export interface PaystackOptions {
  readonly secretKey: string;
  /** A fictional South African recipient for the test transfer. */
  readonly recipient: {
    readonly name: string;
    readonly accountNumber: string;
    readonly bankCode: string | null;
  };
  readonly fetchFn?: typeof fetch;
}

const PAYSTACK = 'https://api.paystack.co';

/** The rand payout as a Paystack test-mode transfer to a South African bank recipient (type basa). */
export function paystackTestPayout(options: PaystackOptions): PayoutRail {
  if (!options.secretKey.startsWith('sk_test_')) {
    throw new RampError(
      'only a Paystack test key (sk_test_...) may be used; a live key is refused',
    );
  }
  const fetchFn = options.fetchFn ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.secretKey}`,
    'Content-Type': 'application/json',
  };
  const call = async (path: string, init?: { method: string; body: unknown }) => {
    const res = await fetchFn(`${PAYSTACK}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const json = (await res.json()) as { status?: boolean; message?: string; data?: unknown };
    if (!res.ok || json.status !== true) {
      throw new RampError(
        `Paystack test mode refused ${path} (HTTP ${String(res.status)}): ${json.message ?? 'no reason given'}`,
      );
    }
    return json.data;
  };
  let recipientCode: string | null = null;
  return {
    async pay(request) {
      if (recipientCode === null) {
        let bankCode = options.recipient.bankCode;
        if (bankCode === null) {
          const banks = (await call('/bank?currency=ZAR')) as { code?: string }[];
          bankCode = banks.find((bank) => typeof bank.code === 'string')?.code ?? null;
          if (bankCode === null) throw new RampError('Paystack returned no South African banks');
        }
        const recipient = (await call('/transferrecipient', {
          method: 'POST',
          body: {
            type: 'basa',
            name: options.recipient.name,
            account_number: options.recipient.accountNumber,
            bank_code: bankCode,
            currency: 'ZAR',
          },
        })) as { recipient_code?: string };
        if (typeof recipient.recipient_code !== 'string') {
          throw new RampError('Paystack returned no recipient code');
        }
        recipientCode = recipient.recipient_code;
      }
      const reference = `signoff-${request.invoiceNumber.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${String(Date.now())}`;
      const transfer = (await call('/transfer', {
        method: 'POST',
        body: {
          source: 'balance',
          amount: request.amountZarMinor,
          currency: 'ZAR',
          recipient: recipientCode,
          reason: `SignOff Testnet demo payout for ${request.invoiceNumber}`,
          reference,
        },
      })) as { status?: string; transfer_code?: string };
      const status = transfer.status ?? 'unknown';
      return {
        provider: 'paystack-test',
        reference,
        status,
        text: `Supplier payout for ${request.invoiceNumber}: R${(request.amountZarMinor / 100).toFixed(2)} sent as a Paystack TEST-MODE transfer (status ${status}, reference ${reference}). Simulated: no money moved.`,
      };
    },
  };
}
