// Ports for one demo run. Defaults are the first demo's ports; a second clean demo sets its own in the environment
// together with SIGNOFF_LOCAL_DIR (its own state folder), so the two runs share nothing but the Testnet.

export const DEFAULT_WARDEN_PORT = 8789;
export const DEFAULT_CONSOLE_PORT = 4180;

export interface DemoPorts {
  readonly warden: number;
  readonly console: number;
}

/** A port from its text. Empty means the fallback. Anything that is not a port number from 1024 to 65535 is refused. */
function portOf(name: string, text: string | undefined, fallback: number): number {
  if (text === undefined || text.trim() === '') {
    return fallback;
  }
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new RangeError(`${name} must be a whole port number from 1024 to 65535`);
  }
  return value;
}

/** Reads SIGNOFF_DEMO_WARDEN_PORT and SIGNOFF_DEMO_CONSOLE_PORT. */
export function demoPortsOf(env: NodeJS.ProcessEnv): DemoPorts {
  const ports = {
    warden: portOf(
      'SIGNOFF_DEMO_WARDEN_PORT',
      env['SIGNOFF_DEMO_WARDEN_PORT'],
      DEFAULT_WARDEN_PORT,
    ),
    console: portOf(
      'SIGNOFF_DEMO_CONSOLE_PORT',
      env['SIGNOFF_DEMO_CONSOLE_PORT'],
      DEFAULT_CONSOLE_PORT,
    ),
  };
  if (ports.warden === ports.console) {
    throw new RangeError('the Warden and the console need different ports');
  }
  return ports;
}
