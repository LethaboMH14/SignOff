import type { AgentActor, AgentState, MapEventInput } from '../src/model/states.js';

/**
 * Scripted moves for the public, simulated console. A visitor presses a button and watches one invoice travel the same
 * states, in the same order and with the same actors, as the agent's pipeline writes them. Nothing is sent anywhere:
 * the moves exist only in this browser tab, and the page labels them as a simulated replay.
 */

export type ReplayKind = 'paid' | 'fraud';

type Step = readonly [AgentState | null, AgentState, AgentActor, string];

/** A clean invoice: read, checked, matched, approved by the Warden, paid and reconciled. */
const PAID_STEPS: readonly Step[] = [
  [null, 'RECEIVED', 'intake', 'OK'],
  ['RECEIVED', 'EXTRACTED', 'extractor', 'OK'],
  ['EXTRACTED', 'EVIDENCE_VERIFIED', 'verifier', 'OK'],
  ['EVIDENCE_VERIFIED', 'WARDEN_ELIGIBLE', 'matcher', 'OK'],
  ['WARDEN_ELIGIBLE', 'SIGNED', 'signer', 'OK'],
  ['SIGNED', 'SUBMITTED', 'submitter', 'SENT'],
  ['SUBMITTED', 'VALIDATED', 'warden', 'PAID'],
  ['VALIDATED', 'RECONCILED', 'reconciler', 'MATCHED'],
];

/** An invoice that asks for the payee to change: the screen quarantines it before any model reads it. */
const FRAUD_STEPS: readonly Step[] = [
  [null, 'RECEIVED', 'intake', 'OK'],
  ['RECEIVED', 'QUARANTINED', 'screen', 'PAYEE_CHANGE_CLAIM'],
];

/** How long each scripted move waits after the one before it. */
export const REPLAY_STEP_MS = 1100;

/**
 * Replayed moves are numbered straight after the last real one. The replay is offered only on the simulated console,
 * whose log is a fixed file, so no real move can arrive later with one of these numbers.
 */
const SEQ_STEP = 1;

function hexId(random: () => number): string {
  let id = '';
  for (let index = 0; index < 64; index += 1) {
    id += Math.floor(random() * 16).toString(16);
  }
  return id;
}

/** The scripted moves for one invoice, numbered after `lastSeq`. Pure apart from the given clock and random source. */
export function replayEvents(
  kind: ReplayKind,
  lastSeq: number,
  now: () => Date = () => new Date(),
  random: () => number = Math.random,
): readonly MapEventInput[] {
  const steps = kind === 'paid' ? PAID_STEPS : FRAUD_STEPS;
  const correlationId = hexId(random);
  const start = now().getTime();
  return steps.map(([fromState, toState, actor, reasonCode], index) => ({
    seq: lastSeq + SEQ_STEP * (index + 1),
    at: new Date(start + REPLAY_STEP_MS * index).toISOString(),
    correlationId,
    fromState,
    toState,
    actor,
    reasonCode,
    policyVersion: 'simulated-replay',
  }));
}
