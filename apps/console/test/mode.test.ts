import { describe, expect, it } from 'vitest';

import { resolveConsoleMode } from '../src/server/mode.js';

describe('console run mode', () => {
  it('defaults to the live Warden with no fixture values', () => {
    expect(resolveConsoleMode({})).toEqual({ mode: 'live', devFixtures: false, demoRandPerUnit: null });
  });

  it('refuses the simulated replay unless the developer dev flag is set', () => {
    expect(() => resolveConsoleMode({ SIGNOFF_CONSOLE_MODE: 'simulated' })).toThrow(/SIGNOFF_CONSOLE_DEV_FIXTURES=1/);
    expect(() => resolveConsoleMode({ SIGNOFF_CONSOLE_MODE: 'simulated', SIGNOFF_CONSOLE_DEV_FIXTURES: '0' })).toThrow(
      /SIGNOFF_CONSOLE_DEV_FIXTURES=1/,
    );
  });

  it('runs the simulated replay only with the dev flag, and only then keeps the placeholder rand rate', () => {
    expect(
      resolveConsoleMode({ SIGNOFF_CONSOLE_MODE: 'simulated', SIGNOFF_CONSOLE_DEV_FIXTURES: '1' }),
    ).toEqual({ mode: 'simulated', devFixtures: true, demoRandPerUnit: null });
    expect(
      resolveConsoleMode({
        SIGNOFF_CONSOLE_MODE: 'simulated',
        SIGNOFF_CONSOLE_DEV_FIXTURES: '1',
        SIGNOFF_DEMO_RAND_PER_UNIT: '18.50',
      }).demoRandPerUnit,
    ).toBe('18.50');
  });

  it('drops the placeholder rand rate in live mode even when it is set', () => {
    expect(resolveConsoleMode({ SIGNOFF_DEMO_RAND_PER_UNIT: '18.50' }).demoRandPerUnit).toBeNull();
  });

  it('fails closed on an unknown mode or a malformed flag', () => {
    expect(() => resolveConsoleMode({ SIGNOFF_CONSOLE_MODE: 'demo' })).toThrow(RangeError);
    expect(() => resolveConsoleMode({ SIGNOFF_CONSOLE_DEV_FIXTURES: 'yes' })).toThrow(RangeError);
  });
});
