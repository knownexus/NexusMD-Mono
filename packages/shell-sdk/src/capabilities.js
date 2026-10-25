// Apps never import each other. When one app offers something another may use
// (e.g. the Editor opening a path), it registers a named capability; consumers
// ask `has()` first and hide the feature when nobody provides it.
export function createCapabilities() {
  const fns = new Map()
  return {
    provide(name, fn) {
      if (typeof fn !== 'function') throw new TypeError(`capability "${name}" must be a function`)
      fns.set(name, fn)
      return () => { if (fns.get(name) === fn) fns.delete(name) }
    },
    has: name => fns.has(name),
    call(name, ...args) {
      const fn = fns.get(name)
      if (!fn) throw new Error(`capability "${name}" is not available`)
      return fn(...args)
    },
  }
}
