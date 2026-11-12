/**
 * The console's run mode, decided from the environment in one place.
 *
 * The normal path is `live`: the console reads the agent's transition log and calls the live Warden. A fixture replay
 * (`simulated`) and the placeholder rand rate exist only for the developer's own review, and only when the developer
 * names the dev flag `SIGNOFF_CONSOLE_DEV_FIXTURES=1`. Without that flag, asking for `simulated` is an error, never a
 * silent fallback (fail closed).
 */

export type ConsoleMode = 'simulated' | 'live';

export interface ModeDecision {
  readonly mode: ConsoleMode;
  /** True only when the developer's dev flag is set. Every fixture-backed value is gated on this. */
  readonly devFixtures: boolean;
  /** The placeholder rand rate, or null. It is set only with the dev flag, and the receipt labels it SIMULATED. */
  readonly demoRandPerUnit: string | null;
}

export const DEV_FIXTURES_FLAG = 'SIGNOFF_CONSOLE_DEV_FIXTURES';

/** Reads the mode from the environment. Defaults to `live`; `simulated` needs the dev flag set to `1`. */
export function resolveConsoleMode(env: NodeJS.ProcessEnv): ModeDecision {
  const text = env['SIGNOFF_CONSOLE_MODE'] ?? 'live';
  if (text !== 'simulated' && text !== 'live') {
    throw new RangeError('SIGNOFF_CONSOLE_MODE must be simulated or live');
  }
  const devFlag = env[DEV_FIXTURES_FLAG];
  if (devFlag !== undefined && devFlag !== '1' && devFlag !== '0') {
    throw new RangeError(`${DEV_FIXTURES_FLAG} must be 1 or 0`);
  }
  const devFixtures = devFlag === '1';
  if (text === 'simulated' && !devFixtures) {
    throw new RangeError(
      `simulated mode is a fixture replay; set ${DEV_FIXTURES_FLAG}=1 to run it for development`,
    );
  }
  const rate = env['SIGNOFF_DEMO_RAND_PER_UNIT'];
  return {
    mode: text,
    devFixtures,
    demoRandPerUnit: devFixtures && rate !== undefined && rate !== '' ? rate : null,
  };
}
