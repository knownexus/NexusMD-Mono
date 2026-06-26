// In-memory adapter implementations for tests (no DOM, no disk).

/** IStorageAdapter backed by a Map (stores values as-is). */
export function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, v) },
    remove: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}

/** IFileAdapter backed by a Map keyed on full path. */
export function memFile(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    async read(path) { if (!files.has(path)) throw new Error('ENOENT ' + path); return files.get(path) },
    async write(path, text) { files.set(path, text) },
    async exists(path) { return files.has(path) },
    async list(dir) {
      const pre = dir.endsWith('/') ? dir : dir + '/'
      return [...files.keys()]
        .filter((k) => k.startsWith(pre))
        .map((k) => k.slice(pre.length).split('/')[0])
    },
    async delete(path) { files.delete(path) },
    async mkdir() { /* dirs are implicit */ },
    async defaultProfileDir() { return '/profiles' },
    _dump: () => Object.fromEntries(files),
  }
}
