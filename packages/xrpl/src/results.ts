/**
 * What a submit response means for the transaction:
 * - accepted: relayed or queued; the outcome is only known after validation (reconcile).
 * - applied-failure: applied to a ledger with a failure result (fee charged); reconcile for the final result.
 * - rejected: not applied and never will be from this submission (tef, tem). Terminal.
 * - deferred: not applied yet (ter, tel); reconcile, and an identical resubmission is safe.
 * - unknown: an unrecognised code; treated like deferred, never like success.
 */
export type SubmitClass = 'accepted' | 'applied-failure' | 'rejected' | 'deferred' | 'unknown';

export function classifySubmitResult(engineResult: string): SubmitClass {
  if (engineResult === 'tesSUCCESS' || engineResult === 'terQUEUED') {
    return 'accepted';
  }
  if (engineResult.startsWith('tec')) {
    return 'applied-failure';
  }
  if (engineResult.startsWith('tef') || engineResult.startsWith('tem')) {
    return 'rejected';
  }
  if (engineResult.startsWith('ter') || engineResult.startsWith('tel')) {
    return 'deferred';
  }
  return 'unknown';
}
