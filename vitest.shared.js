import { fileURLToPath } from 'node:url'

// What every project's vitest.config.js spreads into `test`, so each test starts from a clean slate
// and its result never depends on which tests ran before it or what else is running alongside.
//
// Timeouts are only there to catch a hang, never to judge speed: under a full parallel run a test can
// take many times longer than alone, and that must not fail it. A test that is about timing uses fake
// timers (vi.useFakeTimers) instead of waiting on the clock.
export const HANG_TIMEOUT = 300_000

export const isolation = {
  testTimeout: HANG_TIMEOUT,
  hookTimeout: HANG_TIMEOUT,
  // Spies, stubbed globals and env vars are put back after every test.
  restoreMocks: true,
  unstubGlobals: true,
  unstubEnvs: true,
}

// Runs before each project's own setup file: see test-isolation.setup.js.
export const isolationSetup = fileURLToPath(new URL('./test-isolation.setup.js', import.meta.url))
