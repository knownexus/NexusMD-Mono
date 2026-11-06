// log-fetch.js — every network request a window makes that does not go as expected leaves a line in the log, even when the code that
// made it handles the failure and carries on (a sign-in screen that says "Cannot reach the server" must also say why, in the log).
//
//   could not be made at all (offline, DNS, TLS, CORS, refused)   warn   request failed: POST api.example.com/api/account/login
//   the server answered 5xx                                       warn   request failed: GET x.test/a (503)
//   the server answered 4xx                                       info   request was refused: GET x.test/b (404)
//   the page cancelled it (AbortController)                       debug  request cancelled: ...
//
// The page gets exactly what it would have got: the same response object, or the same error rethrown. Nothing is read from the
// body. The log gets the method, the address WITHOUT its query string, fragment or password (tokens and codes travel there), the
// status and how long it took. A request that fails over and over (a poll while offline) is filed once a minute with a count.
import { rendererLog } from './log.js'

const MARK = Symbol.for('nexusmd.fetchLogging')
const REPEAT_MS = 60 * 1000
const MAX_KEYS = 500

// The logger failing must not break the page; the last failure is kept so it can still be seen in a debugger.
let loggerFailure = null
export const lastFetchLoggingFailure = () => loggerFailure

function describeAddress(input, base) {
  const raw = typeof input === 'string' ? input
    : (typeof URL !== 'undefined' && input instanceof URL) ? input.href
      : (input && typeof input.url === 'string') ? input.url : String(input)
  try {
    const u = new URL(raw, base)
    u.username = ''; u.password = ''; u.search = ''; u.hash = ''
    return { url: u.href, shown: `${u.host}${u.pathname}` }
  } catch (err) {
    loggerFailure = err
    return { url: '(unreadable address)', shown: '(unreadable address)' }
  }
}

/**
 * @param {{ fetch?: Function }|undefined} target the window (anything with a fetch); the page's own when not given
 * @param {{ log?: object, now?: () => number, base?: string }} [opts]
 * @returns {() => void} puts the original fetch back
 */
export function installFetchLogging(target = typeof window !== 'undefined' ? window : globalThis, { log = rendererLog('core', 'network'), now = () => Date.now(), base = typeof location !== 'undefined' ? location.href : undefined } = {}) {
  const original = target?.fetch
  if (typeof original !== 'function' || original[MARK]) return () => {}
  const seen = new Map() // what failed -> { last, suppressed }

  function file(level, key, message, err, data) {
    try {
      const at = now()
      const prior = seen.get(key)
      if (prior && at - prior.last < REPEAT_MS) { prior.suppressed++; return }
      if (seen.size >= MAX_KEYS) seen.clear()
      seen.set(key, { last: at, suppressed: 0 })
      const detail = prior?.suppressed ? { ...data, suppressed: prior.suppressed } : data
      if (err !== undefined) log[level](message, err, detail)
      else log[level](message, detail)
    } catch (loggingError) {
      loggerFailure = loggingError
    }
  }

  const wrapped = function fetchWithLogging(...args) {
    const [input, init] = args
    let method = 'GET'
    let address
    let started = 0
    try {
      method = String(init?.method ?? (input && typeof input === 'object' ? input.method : undefined) ?? 'GET').toUpperCase()
      address = describeAddress(input, base)
      started = now()
    } catch (err) {
      loggerFailure = err
      return original.apply(this, args)
    }
    const { url, shown } = address
    return original.apply(this, args).then(
      (res) => {
        try {
          const status = res?.status
          if (status >= 500) file('warn', `${method} ${url} ${status}`, `request failed: ${method} ${shown} (${status})`, undefined, { method, url, status, ms: now() - started })
          else if (status >= 400) file('info', `${method} ${url} ${status}`, `request was refused: ${method} ${shown} (${status})`, undefined, { method, url, status, ms: now() - started })
        } catch (err) {
          loggerFailure = err
        }
        return res
      },
      (err) => {
        const data = { method, url, ms: now() - started }
        if (err?.name === 'AbortError') file('debug', `${method} ${url} abort`, `request cancelled: ${method} ${shown}`, undefined, data)
        else file('warn', `${method} ${url} network`, `request failed: ${method} ${shown}`, err, data)
        throw err
      },
    )
  }
  wrapped[MARK] = true
  target.fetch = wrapped
  return () => { if (target.fetch === wrapped) target.fetch = original }
}
