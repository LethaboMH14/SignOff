// Platform-neutral entry point (import from '@signoff/shared'). It holds money rules and schemas
// only, with no Node built-ins, so browser code can import it. Node-only code is in './node'.

/** The package name every SignOff service uses when it imports shared code. */
export const SHARED_PACKAGE_NAME = '@signoff/shared' as const;

export * from './money/minor-units.js';
export * from './evidence-register.js';
export * from './schemas/index.js';
export * from './match-rules.js';
