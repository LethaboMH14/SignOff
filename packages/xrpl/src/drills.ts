import type { LedgerPort } from './port.js';
import { hashOfSigned } from './multisig.js';
import {
  planTwoSignature,
  assertSignerConfiguration,
  loadSigners,
  PaymentError,
  type PaymentDeps,
  type Transfer,
} from './payments.js';
import { resumeAndReconcile, sendAndReconcile } from './reliable.js';
import type { Decision } from './reconcile.js';

export interface TimeoutDrillReport {
  readonly decision: Decision;
  /** Submissions the port made. */
  readonly submissions: number;
  /** Distinct signed blobs among them. One blob means the same transaction was never re-signed. */
  readonly distinctBlobs: number;
  readonly hash: string;
}

/**
 * Timeout then reconcile. The first submission reaches the ledger, but its response is lost on the way
 * back. The payment must still be found by its hash and settled exactly once, without a second signing.
 */
export async function timeoutDrill(
  deps: PaymentDeps,
  transfer: Transfer,
): Promise<TimeoutDrillReport> {
  const signers = await loadSigners(deps);
  await assertSignerConfiguration(deps.port, transfer.from, signers);
  const plan = await planTwoSignature(
    deps,
    { ...transfer, paymentId: `${transfer.paymentId}.timeout` },
    signers,
    1,
  );
  const blobs = new Set<string>();
  let submissions = 0;
  let lost = false;
  const lossy: LedgerPort = {
    ...deps.port,
    submit: async (blob: string) => {
      submissions += 1;
      blobs.add(blob);
      const outcome = await deps.port.submit(blob);
      if (!lost) {
        lost = true;
        throw new Error('response lost (drill)');
      }
      return outcome;
    },
  };
  const decision = await sendAndReconcile(plan, { ...deps, port: lossy });
  return { decision, submissions, distinctBlobs: blobs.size, hash: plan.hash };
}

export interface FailoverDrillReport {
  readonly primary: string;
  readonly secondary: string;
  readonly decision: Decision;
  readonly hash: string;
}

/**
 * Failover. The primary endpoint fails with the transaction in flight. The same signed blob is then
 * resumed on the secondary endpoint and must settle under the identical hash.
 */
export async function failoverDrill(
  deps: PaymentDeps,
  transfer: Transfer,
  secondary: LedgerPort,
): Promise<FailoverReport> {
  const signers = await loadSigners(deps);
  await assertSignerConfiguration(deps.port, transfer.from, signers);
  const plan = await planTwoSignature(
    deps,
    { ...transfer, paymentId: `${transfer.paymentId}.failover` },
    signers,
    1,
  );
  const downPrimary: LedgerPort = {
    ...deps.port,
    submit: () => Promise.reject(new Error('primary unreachable (drill)')),
    lookup: () => Promise.reject(new Error('primary unreachable (drill)')),
  };
  let primaryFailed = false;
  try {
    await sendAndReconcile(plan, { ...deps, port: downPrimary, maxPolls: 1 });
  } catch {
    primaryFailed = true;
  }
  if (!primaryFailed) {
    throw new PaymentError('the primary endpoint was expected to fail during the drill');
  }
  const decision = await resumeAndReconcile(plan, { ...deps, port: secondary });
  return {
    primary: deps.port.endpoint,
    secondary: secondary.endpoint,
    decision,
    hash: hashOfSigned(plan.txBlob),
  };
}

export interface FailoverReport {
  readonly primary: string;
  readonly secondary: string;
  readonly decision: Decision;
  readonly hash: string;
}
