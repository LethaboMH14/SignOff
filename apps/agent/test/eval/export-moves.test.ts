import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AGENT_POLICY_VERSION } from '../../src/config.js';
import { loadLabelledSet } from '../../src/eval/cases.js';
import { evaluate } from '../../src/eval/run.js';
import { simulatedModel } from '../../src/eval/simulated-model.js';
import type { TransitionRecord } from '../../src/log/transition-log.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/labelled', import.meta.url));

describe('the evaluation exports each case moves, for the agent map', () => {
  it('hands over one batch per labelled case, each starting at its first move and in order', async () => {
    const set = loadLabelledSet(FIXTURES);
    const batches: (readonly TransitionRecord[])[] = [];
    await evaluate({
      set,
      model: simulatedModel('extractor'),
      baselineModel: simulatedModel('baseline'),
      policyVersion: AGENT_POLICY_VERSION,
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      onRecords: (records) => {
        batches.push(records);
      },
    });
    expect(batches).toHaveLength(set.cases.length);
    for (const records of batches) {
      expect(records.length).toBeGreaterThan(0);
      expect(records[0]?.fromState).toBeNull();
      records.forEach((record, index) => {
        expect(record.seq).toBe(index + 1);
      });
    }
  }, 60_000);
});
