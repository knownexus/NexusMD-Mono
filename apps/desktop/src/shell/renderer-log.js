// Logging for the renderer: what happens in the window reaches the shell's log hub (main process),
// filed under the app whose screen it happened on, so a renderer failure is as traceable as a main one.
//
//   rendererLog('git').error('diff failed', err)   // an app's own logger
//   installRendererErrorHooks()                    // uncaught errors and unhandled rejections
//   setActiveModule('git')                         // the shell says which app's screen is showing
//
// Entries go to window.electronAPI.logging.ingest; outside Electron (tests, a browser) there is nowhere
// to send them and every call is a no-op.

let activeModule = 'core'
/** The app whose screen is showing; what an error nobody claimed is filed under. */
export const setActiveModule = id => { activeModule = typeof id === 'string' && id ? id : 'core' }
export const getActiveModule = () => activeModule

const sender = () => (typeof window !== 'undefined' ? window.electronAPI?.logging?.ingest : undefined)

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

/** A logger for one app (or 'core'): log.error('msg', err?, data?), same shape as the main process's. */
export function rendererLog(mod = 'core', scope = null) {
  const emit = lvl => (msg, a, b) => {
    const isErr = a instanceof Error
    sendEntry({ mod, lvl, scope, msg: String(msg), ...(isErr ? { err: serializeError(a), data: b } : { data: a }) })
  }
  return {
    error: emit('error'), warn: emit('warn'), info: emit('info'), debug: emit('debug'),
    scope: name => rendererLog(mod, scope ? `${scope}:${name}` : name),
  }
}

/** A React error boundary caught this; filed under the screen that was showing. */
export function reportRenderError(error, componentStack, mod = activeModule) {
  return sendEntry({ mod, lvl: 'error', scope: 'render', msg: 'Uncaught render error', err: serializeError(error), data: componentStack ? { componentStack } : undefined })
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
