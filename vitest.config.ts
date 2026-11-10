import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    // An empty test run is a failure, never a silent pass.
    passWithNoTests: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', 'scripts/lib/**/*.ts'],
      // A process entry point wires real files, the testnet port and the process itself. It is exercised by the
      // live Testnet run recorded in the test log, not by unit tests (see DECISION-JOURNAL).
      exclude: ['apps/*/src/main.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
