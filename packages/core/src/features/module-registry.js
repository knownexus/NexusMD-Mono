let _registry = []

export function registerModule(module) {
  _registry.push(module)
}

export function getRegistry() {
  return _registry
}

// Used in tests and by initCore to reset between test runs.
export function clearRegistry() {
  _registry = []
}

/**
 * Set each registered module's `_enabled` flag from a profile's `modules` config.
 * A module with no entry in the profile falls back to its own `defaultEnabled`.
 * Passing a null/undefined profile applies `defaultEnabled` to every module.
 */
export function applyEnabledModules(profile) {
  const mods = profile?.modules
  for (const m of _registry) {
    const cfg = mods?.[m.id]
    m._enabled = cfg ? !!cfg.enabled : (m.defaultEnabled ?? false)
  }
}

/** True if every adapter id in `module.requiredAdapters` is present in `adapters`. */
export function hasRequiredAdapters(module, adapters) {
  const required = module.requiredAdapters || []
  return required.every(key => adapters && adapters[key] != null)
}
