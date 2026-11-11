import { describe, expect, it } from 'vitest';

import { summarizeSynthetic } from './synthetic-check.js';

const OK = { status: 'ok', detail: 'fine' } as const;
const FAILED = { status: 'failed', detail: 'no endpoint answered' } as const;
const NOT_CHECKED = { status: 'not-checked', detail: 'the address is not set' } as const;

describe('the synthetic check summary', () => {
  it('is ok when every check passed, and exits 0', () => {
    const summary = summarizeSynthetic([
      { name: 'ledger', result: OK },
      { name: 'warden', result: OK },
    ]);
    expect(summary).toEqual({
      overall: 'ok',
      lines: ['ledger: OK. fine', 'warden: OK. fine'],
      exitCode: 0,
    });
  });

  it('is unverified, and still exits 0, when a check was not set up', () => {
    const summary = summarizeSynthetic([
      { name: 'ledger', result: OK },
      { name: 'account', result: NOT_CHECKED },
    ]);
    expect(summary.overall).toBe('unverified');
    expect(summary.exitCode).toBe(0);
    expect(summary.lines[1]).toBe('account: NOT CHECKED (UNVERIFIED). the address is not set');
  });

  it('fails, and exits 1, when any check failed, even beside one that was not checked', () => {
    const summary = summarizeSynthetic([
      { name: 'ledger', result: FAILED },
      { name: 'account', result: NOT_CHECKED },
    ]);
    expect(summary.overall).toBe('failed');
    expect(summary.exitCode).toBe(1);
    expect(summary.lines[0]).toBe('ledger: FAILED. no endpoint answered');
  });
});
