// secret-cache.js — an in-memory, synchronously readable view of a secure-storage adapter.
//
// Secure storage is asynchronous (it decrypts), but the clients that need a token (the ADO /
// GitHub / Jira configs, the cloud OAuth bindings) read it synchronously. The platform wraps its
// adapter in this cache, loads the names it needs once at start (before the screens that read
// them mount), and every get/set/remove made through the cache keeps it current. With no
// backend bound it works in memory only (tests, hosts without secure storage).
//
// Headless: the backend is any { get(name), set(name, value), remove(name) } returning promises.

export function createSecretCache(backend = null) {
  let inner = backend
  const cache = new Map()
  const remember = (name, v) => { if (v == null) cache.delete(name); else cache.set(name, String(v)) }

  /** The cached value, or null when the name is not loaded / not set. Synchronous. */
  const peek = (name) => (cache.has(name) ? cache.get(name) : null)
  const get = async (name) => {
    if (!inner) return peek(name)
    const v = await inner.get(name)
    remember(name, v)
    return v ?? null
  }
  /** Updates the cache at once; the returned promise settles when the backend has it. */
  const set = (name, value) => {
    remember(name, value)
    return inner ? Promise.resolve(inner.set(name, value)) : Promise.resolve()
  }
  const remove = (name) => {
    cache.delete(name)
    return inner ? Promise.resolve(inner.remove(name)) : Promise.resolve()
  }
  /** Reads each name from the backend into the cache. */
  const load = async (names) => { await Promise.all([...new Set(names)].map(get)) }
  const bind = (next) => { inner = next || null }

  return { bind, peek, get, set, remove, load }
}
