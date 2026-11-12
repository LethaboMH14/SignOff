import { describe, expect, it } from 'vitest';
import { demoPortsOf } from '../demo/ports.js';

describe('demo ports', () => {
  it('uses the first demo ports when nothing is set', () => {
    expect(demoPortsOf({})).toEqual({ warden: 8789, console: 4180 });
  });

  it('takes a second demo its own ports', () => {
    expect(
      demoPortsOf({ SIGNOFF_DEMO_WARDEN_PORT: '8790', SIGNOFF_DEMO_CONSOLE_PORT: '4181' }),
    ).toEqual({ warden: 8790, console: 4181 });
  });

  it('refuses a value that is not a port, and two ports that are the same', () => {
    expect(() => demoPortsOf({ SIGNOFF_DEMO_WARDEN_PORT: 'eighty' })).toThrow(RangeError);
    expect(() => demoPortsOf({ SIGNOFF_DEMO_WARDEN_PORT: '80' })).toThrow(RangeError);
    expect(() =>
      demoPortsOf({ SIGNOFF_DEMO_WARDEN_PORT: '5000', SIGNOFF_DEMO_CONSOLE_PORT: '5000' }),
    ).toThrow(RangeError);
  });
});
