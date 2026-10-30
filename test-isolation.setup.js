import { afterEach, vi } from 'vitest'

// Loaded by every project (see vitest.shared.js). After each test it puts back what a test can leave
// behind, so no test sees another's leftovers.

// Testing Library only cleans up by itself when Vitest's globals are on, and they are off here, so
// rendered trees would stay mounted into the next test. Its waits (waitFor, findBy*) give up after one
// second by default, which a busy machine can exceed: like the test timeout, they only catch a hang.
let rtl = null
try { rtl = await import('@testing-library/react') } catch { /* a project without React */ }
if (rtl) rtl.configure({ asyncUtilTimeout: 30_000 })

afterEach(() => {
  rtl?.cleanup()
  vi.useRealTimers()
  globalThis.localStorage?.clear?.()
  globalThis.sessionStorage?.clear?.()
})
