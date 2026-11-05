// Logging for code that runs in a window: what happens there reaches the shell's log hub (main process),
// filed under the app whose screen it happened on, so a renderer failure is as traceable as a main one.
// This lives in core so everything that runs in a window (the shell, the apps, the shared screens)
// logs the same way.
//
//   const log = rendererLog('git', 'diff')        // an app's own logger
//   log.error('diff failed', err, { file })       // (msg, error?, data?) — or (msg, data?)
//   installRendererErrorHooks()                   // uncaught errors and unhandled rejections
//   setActiveModule('git')                        // the shell says which app's screen is showing
//
// Entries go to window.electronAPI.logging.ingest. Without it (the web app, tests) there is nowhere
// to send them, so a logger call goes to the console instead; the hooks install nothing, because the
// browser reports those itself.

let activeModule = 'core'
/** The app whose screen is showing; what an error nobody claimed is filed under. */
export const setActiveModule = id => { activeModule = typeof id === 'string' && id ? id : 'core' }
export const getActiveModule = () => activeModule

const sender = () => (typeof window !== 'undefined' ? window.electronAPI?.logging?.ingest : undefined)

const looksLikeError = v => v instanceof Error || (v && typeof v === 'object' && typeof v.message === 'string' && ('stack' in v || 'name' in v))

/** { name, message, stack } for anything that was thrown (it may not be an Error). */
export function serializeError(value) {
  if (value && typeof value === 'object' && 'message' in value) {
    return { name: String(value.name || 'Error'), message: String(value.message), ...(value.stack ? { stack: String(value.stack) } : {}) }
  }
  let message
  try { message = typeof value === 'string' ? value : JSON.stringify(value) } catch { message = String(value) }
  return { name: 'NonError', message: message ?? String(value) }
}

/** Sends one entry. Never throws: logging must not be what breaks the screen. */
export function sendEntry(entry, send = sender()) {
  if (!send) return false
  try {
    send({ ts: new Date().toISOString(), ...entry })
    return true
  } catch {
    return false // nowhere left to report this to
  }
}

const CONSOLE = { error: 'error', warn: 'warn', info: 'info', debug: 'debug' }
function toConsole(lvl, mod, scope, msg, err, data) {
  const fn = (typeof console !== 'undefined' && console[CONSOLE[lvl]]) || undefined
  if (!fn) return
  const extra = [err, data].filter(x => x !== undefined)
  fn.call(console, `[${scope ? `${mod}:${scope}` : mod}] ${msg}`, ...extra)
}

/** A logger for one app (or 'core'): log.error('msg', err?, data?), same shape as the main process's. */
export function rendererLog(mod = 'core', scope = null) {
  const emit = lvl => (msg, a, b) => {
    const isErr = looksLikeError(a)
    const err = isErr ? a : undefined
    const data = isErr ? b : a
    const sent = sendEntry({ mod, lvl, scope, msg: String(msg), ...(isErr ? { err: serializeError(err) } : {}), data })
    if (!sent) toConsole(lvl, mod, scope, String(msg), err, data)
  }
  return {
    error: emit('error'), warn: emit('warn'), info: emit('info'), debug: emit('debug'),
    scope: name => rendererLog(mod, scope ? `${scope}:${name}` : name),
  }
}

/** A React error boundary caught this; filed under the screen that was showing. */
export function reportRenderError(error, componentStack, mod = activeModule) {
  const sent = sendEntry({ mod, lvl: 'error', scope: 'render', msg: 'Uncaught render error', err: serializeError(error), data: componentStack ? { componentStack } : undefined })
  if (!sent) toConsole('error', mod, 'render', 'Uncaught render error', error, componentStack)
  return sent
}

/**
 * Logs uncaught errors and unhandled promise rejections. Once an entry has been sent, the event's
 * default is cancelled so the console doesn't print it a second time (the shell forwards console
 * output to the log as well, which would file the same failure again, unattributed).
 * @returns {() => void} removes the hooks
 */
export function installRendererErrorHooks(target = typeof window !== 'undefined' ? window : undefined, send = sender()) {
  if (!target || !send) return () => {}
  const onError = event => {
    const err = event.error ?? { name: 'Error', message: event.message }
    const where = event.filename ? { file: event.filename, line: event.lineno, col: event.colno } : undefined
    if (sendEntry({ mod: activeModule, lvl: 'error', scope: 'window.onerror', msg: event.message || 'Uncaught error', err: serializeError(err), data: where }, send)) event.preventDefault?.()
  }
  const onRejection = event => {
    const err = serializeError(event.reason)
    if (sendEntry({ mod: activeModule, lvl: 'error', scope: 'unhandledrejection', msg: `Unhandled promise rejection: ${err.message}`, err }, send)) event.preventDefault?.()
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
