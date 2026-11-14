/**
 * Owner approval for high-value payments. The Warden has already checked and signed; the owner adds the third
 * signature on their phone in Xaman, guarded by the Xaman PIN or biometrics. The ledger refuses the payment
 * without it (quorum 3), so this module is a convenience for collecting a signature, not the control itself.
 *
 * Nothing here prints a key, secret or token. The returned blob is checked by the service before it is used.
 */

/** What the owner is asked to sign. The transaction is the one the Warden prepared, unchanged. */
export interface OwnerApprovalRequest {
  readonly transaction: Readonly<Record<string, unknown>>;
  /** One line shown in Xaman, e.g. "Pay R100,000 to Thandi's Wholesale for INV-…". */
  readonly instruction: string;
}

/** Why no owner signature came back. Each one leaves the payment unsigned by the owner, so it is never sent. */
export type OwnerApprovalOutcome = 'rejected' | 'expired' | 'unavailable';

export class OwnerApprovalError extends Error {
  constructor(
    readonly outcome: OwnerApprovalOutcome,
    message: string,
  ) {
    super(message);
    this.name = 'OwnerApprovalError';
  }
}

export interface OwnerApprover {
  /** Resolves with a blob signed by the owner alone, or throws OwnerApprovalError. */
  collect(request: OwnerApprovalRequest): Promise<string>;
}

export interface XamanOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly ownerAddress: string;
  /** Push token from an earlier sign-in. Without it the request is opened by link or QR. */
  readonly userToken: string | null;
  /** Minutes before the request expires. Keep it under the agent's HTTP wait (about 5 minutes). */
  readonly expireMinutes: number;
  readonly pollMs: number;
  /** Told the sign link and whether a push was sent, so the operator can open it. Never told a secret. */
  readonly onCreated: (info: { readonly link: string; readonly pushed: boolean }) => void;
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const XAMAN_API = 'https://xumm.app/api/v1/platform';

interface PayloadState {
  readonly meta?: {
    readonly resolved?: boolean;
    readonly signed?: boolean;
    readonly expired?: boolean;
  };
  readonly response?: { readonly hex?: string | null };
}

/** An approver that asks the owner to multisign in Xaman, on XRPL Testnet only. */
export function xamanApprover(options: XamanOptions): OwnerApprover {
  const fetchFn = options.fetchFn ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }));
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': options.apiKey,
    'X-API-Secret': options.apiSecret,
  };
  return {
    async collect(request: OwnerApprovalRequest): Promise<string> {
      const body = {
        txjson: request.transaction,
        options: {
          multisign: true,
          submit: false,
          signers: [options.ownerAddress],
          force_network: 'TESTNET',
          expire: options.expireMinutes,
        },
        custom_meta: { instruction: request.instruction.slice(0, 280) },
        ...(options.userToken === null ? {} : { user_token: options.userToken }),
      };
      let created: Response;
      try {
        created = await fetchFn(`${XAMAN_API}/payload`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new OwnerApprovalError('unavailable', 'Xaman could not be reached');
      }
      if (!created.ok) {
        throw new OwnerApprovalError(
          'unavailable',
          `Xaman refused the approval request (HTTP ${String(created.status)})`,
        );
      }
      const payload = (await created.json()) as {
        readonly uuid?: string;
        readonly next?: { readonly always?: string };
        readonly pushed?: boolean;
      };
      if (typeof payload.uuid !== 'string' || typeof payload.next?.always !== 'string') {
        throw new OwnerApprovalError('unavailable', 'Xaman returned an unexpected reply');
      }
      options.onCreated({ link: payload.next.always, pushed: payload.pushed === true });
      const deadline = Date.now() + (options.expireMinutes * 60 + 30) * 1000;
      while (Date.now() < deadline) {
        await sleep(options.pollMs);
        let state: PayloadState;
        try {
          const res = await fetchFn(`${XAMAN_API}/payload/${payload.uuid}`, { headers });
          if (!res.ok) continue;
          state = (await res.json()) as PayloadState;
        } catch {
          continue;
        }
        if (state.meta?.expired === true) {
          throw new OwnerApprovalError('expired', 'the owner did not approve in time');
        }
        if (state.meta?.resolved !== true) continue;
        const hex = state.response?.hex;
        if (state.meta.signed !== true || typeof hex !== 'string' || hex.length === 0) {
          throw new OwnerApprovalError('rejected', 'the owner rejected the payment');
        }
        return hex;
      }
      throw new OwnerApprovalError('expired', 'the owner did not approve in time');
    },
  };
}
