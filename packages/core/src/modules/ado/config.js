// ado/config.js — read/write the local ADO connection config.
//
// Headless: storage is injected (an IStorageAdapter: get/set/remove/keys) and the
// key-naming strategy is injected as `key(name)`. This lets each platform keep its
// own key scheme (App: helm.android.*, Desktop: ado.*) while sharing the logic that
// used to be copy-pasted into every ado-client.js.

/**
 * @param {object} opts
 * @param {{ get(k:string): (string|null), set(k:string, v:string): void }} opts.storage
 * @param {(name: string) => string} opts.key  Maps a logical name (e.g. 'org') to a storage key.
 * @param {{ uatBranch?: string, refreshSecs?: number }} [opts.defaults]
 */
export function makeAdoConfig({ storage, key, defaults = {} }) {
  if (!storage || typeof key !== 'function') {
    throw new Error('makeAdoConfig requires { storage, key }')
  }
  const get = (name) => storage.get(key(name))

  function getAdoConfig() {
    let projects = []
    try { projects = JSON.parse(get('projects') || '[]') } catch { /* ignore */ }
    return {
      org:           get('org')         || '',
      pat:           get('pat')         || '',
      projects,
      testProject:   get('testProject') || '',
      uatProject:    get('uatProject')  || '',
      uatPipelineId: parseInt(get('uatPipelineId') || '0', 10),
      uatBranch:     get('uatBranch')   || defaults.uatBranch || 'refs/heads/uat',
      refreshSecs:   parseInt(get('refreshSecs') || String(defaults.refreshSecs ?? 30), 10),
    }
  }

  function saveAdoConfig(values = {}) {
    const set = (name, v) => storage.set(key(name), v)
    if (values.org           !== undefined) set('org',           values.org)
    if (values.pat           !== undefined) set('pat',           values.pat)
    if (values.projects      !== undefined) set('projects',      JSON.stringify(values.projects))
    if (values.testProject   !== undefined) set('testProject',   values.testProject)
    if (values.uatProject    !== undefined) set('uatProject',    values.uatProject)
    if (values.uatPipelineId !== undefined) set('uatPipelineId', String(values.uatPipelineId))
    if (values.uatBranch     !== undefined) set('uatBranch',     values.uatBranch)
    if (values.refreshSecs   !== undefined) set('refreshSecs',   String(values.refreshSecs))
  }

  function isAdoConfigured() {
    const c = getAdoConfig()
    return !!(c.org && c.pat && c.projects.length > 0)
  }

  return { getAdoConfig, saveAdoConfig, isAdoConfigured }
}
