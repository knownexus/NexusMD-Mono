// Core event bus — shared by core.js and the profile/module operations.
// Kept in its own module so profile-store can emit without importing core.js
// (which would create an import cycle).

const _listeners = new Map()

export function emit(event, payload) {
  const handlers = _listeners.get(event)
  if (!handlers) return
  for (const cb of handlers) {
    try { cb(payload) } catch (e) { console.error('[core] event handler threw', event, e) }
  }
}

export function on(event, cb) {
  if (!_listeners.has(event)) _listeners.set(event, new Set())
  _listeners.get(event).add(cb)
}

export function off(event, cb) {
  _listeners.get(event)?.delete(cb)
}
