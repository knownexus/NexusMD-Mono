export const CURRENT_PROFILE_VERSION = 1

// Default module config for a freshly-created profile. ADO/GitHub start disabled
// (they need external config); local modules default on.
function defaultModules() {
  return {
    ado:      { enabled: false, org: '', projects: [], testProject: '', uatBranch: '', refreshSecs: 30 },
    github:   { enabled: false, owner: '', repos: [] },
    planner:  { enabled: true },
    triage:   { enabled: true },
    team:     { enabled: true },
    calendar: { enabled: true },
    digest:   { enabled: false },
    audit:    { enabled: true },
  }
}

/**
 * Build a complete, schema-valid profile object from partial options.
 * Required: `name`. Optional: id (generated if absent), type, modules (merged
 * over defaults), preferences, team, created.
 */
export function buildProfile(opts = {}) {
  const modules = { ...defaultModules(), ...(opts.modules || {}) }
  return {
    id:          opts.id || generateProfileId(),
    version:     CURRENT_PROFILE_VERSION,
    name:        opts.name || 'Untitled',
    type:        opts.type || 'ado',
    created:     opts.created || new Date().toISOString(),
    modules,
    preferences: { theme: 'dark', language: 'en', ...(opts.preferences || {}) },
    team:        opts.team || [],
  }
}

/** UUID for a new profile. Uses crypto.randomUUID when available. */
export function generateProfileId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export function validateProfile(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Profile must be a non-null object' }
  }
  if (!data.id || typeof data.id !== 'string') {
    return { valid: false, error: 'Profile must have a string "id" field' }
  }
  if (data.version !== CURRENT_PROFILE_VERSION) {
    return { valid: false, error: `Unsupported profile version: ${data.version} (expected ${CURRENT_PROFILE_VERSION})` }
  }
  if (!data.name || typeof data.name !== 'string') {
    return { valid: false, error: 'Profile must have a string "name" field' }
  }
  if (!data.modules || typeof data.modules !== 'object') {
    return { valid: false, error: 'Profile must have a "modules" object' }
  }
  return { valid: true }
}
