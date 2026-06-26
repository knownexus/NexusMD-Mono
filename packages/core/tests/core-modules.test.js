import { describe, it, expect, beforeEach } from 'vitest'
import { registerModule, clearRegistry } from '../src/features/module-registry.js'
import { core, initCore } from '../src/core.js'
import { createProfile } from '../src/profiles/profile-store.js'

// In-memory adapters
function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    defaultProfileDir: async () => '/profiles',
    list: async (dir) => [...files.keys()].filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)),
    read: async (path) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) },
    write: async (path, text) => { files.set(path, text) },
    delete: async (path) => { files.delete(path) },
    exists: async (path) => files.has(path),
    mkdir: async () => {},
  }
}
function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), keys: () => [...m.keys()] }
}

function spyModule(id, { requiredAdapters = [], defaultEnabled = false, loadResult, throws } = {}) {
  const calls = { init: 0, load: 0, dispose: 0, initCfg: null }
  return {
    mod: {
      id, name: id, requiredAdapters, defaultEnabled,
      init: (adapters, cfg) => { calls.init++; calls.initCfg = cfg },
      load: async () => { calls.load++; if (throws) throw new Error('boom'); return loadResult ?? { id } },
      dispose: () => { calls.dispose++ },
    },
    calls,
  }
}

describe('initCore — profile-driven module enable', () => {
  beforeEach(() => clearRegistry())

  it('enables modules per the active profile (overriding defaultEnabled)', async () => {
    const fs = makeFs(), storage = makeStorage()
    // ado defaultEnabled=false but profile enables it; team defaultEnabled=true but profile disables it
    const profile = await createProfile(fs, storage, {
      name: 'P', id: 'p1',
      modules: { ado: { enabled: true }, team: { enabled: false } },
    })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado', { defaultEnabled: false })
    const team = spyModule('team', { defaultEnabled: true })
    registerModule(ado.mod)
    registerModule(team.mod)

    await initCore({ file: fs, storage })

    expect(core.isEnabled('ado')).toBe(true)
    expect(core.isEnabled('team')).toBe(false)
  })

  it('inits enabled modules and passes their profile config', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: true, org: 'acme' } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado')
    registerModule(ado.mod)
    await initCore({ file: fs, storage })

    expect(ado.calls.init).toBe(1)
    expect(ado.calls.initCfg).toEqual({ enabled: true, org: 'acme' })
  })

  it('does not init a module missing its required adapters', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: true } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado', { requiredAdapters: ['http'] }) // http not provided
    registerModule(ado.mod)
    await initCore({ file: fs, storage })

    expect(core.isEnabled('ado')).toBe(true) // enabled per profile…
    expect(ado.calls.init).toBe(0)           // …but not inited (adapter missing)
  })

  it('falls back to defaultEnabled when no profile resolves', async () => {
    const fs = makeFs(), storage = makeStorage() // no profiles on disk
    const planner = spyModule('planner', { defaultEnabled: true })
    const ado = spyModule('ado', { defaultEnabled: false })
    registerModule(planner.mod)
    registerModule(ado.mod)

    await initCore({ file: fs, storage })

    expect(core.isEnabled('planner')).toBe(true)
    expect(core.isEnabled('ado')).toBe(false)
  })

  it('emits profiles:none when there is no active profile', async () => {
    const fs = makeFs(), storage = makeStorage()
    let fired = false
    const handler = () => { fired = true }
    core.on('profiles:none', handler)
    await initCore({ file: fs, storage })
    core.off('profiles:none', handler)
    expect(fired).toBe(true)
  })

  it('emits profile:activated with the profile when one resolves', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1' })
    storage.set('nexusmd.activeProfileId', 'p1')
    let payload = null
    const handler = (p) => { payload = p }
    core.on('profile:activated', handler)
    await initCore({ file: fs, storage })
    core.off('profile:activated', handler)
    expect(payload?.profile?.id).toBe('p1')
  })
})

describe('core.load', () => {
  beforeEach(() => clearRegistry())

  it('loads enabled+ready modules and emits data:updated', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: true } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado', { loadResult: { workItems: [1, 2] } })
    registerModule(ado.mod)
    await initCore({ file: fs, storage })

    const updates = []
    const handler = (p) => updates.push(p)
    core.on('data:updated', handler)
    const results = await core.load()
    core.off('data:updated', handler)

    expect(ado.calls.load).toBe(1)
    expect(results).toEqual([{ moduleId: 'ado', data: { workItems: [1, 2] } }])
    expect(updates).toEqual([{ moduleId: 'ado', data: { workItems: [1, 2] } }])
  })

  it('emits data:error and keeps going when a module load throws', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: true }, planner: { enabled: true } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado', { throws: true })
    const planner = spyModule('planner', { loadResult: { ok: true } })
    registerModule(ado.mod)
    registerModule(planner.mod)
    await initCore({ file: fs, storage })

    const errors = []
    const handler = (p) => errors.push(p.moduleId)
    core.on('data:error', handler)
    const results = await core.load()
    core.off('data:error', handler)

    expect(errors).toEqual(['ado'])
    expect(results).toEqual([{ moduleId: 'planner', data: { ok: true } }])
  })

  it('skips disabled modules', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: false } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado')
    registerModule(ado.mod)
    await initCore({ file: fs, storage })
    await core.load()
    expect(ado.calls.load).toBe(0)
  })

  it('skips network-requiring modules while offline and emits network:offline', async () => {
    const fs = makeFs(), storage = makeStorage()
    await createProfile(fs, storage, { name: 'P', id: 'p1', modules: { ado: { enabled: true } } })
    storage.set('nexusmd.activeProfileId', 'p1')

    const ado = spyModule('ado', { requiredAdapters: ['network'] })
    registerModule(ado.mod)
    const network = { isOnline: () => false, onChange: () => () => {} }
    await initCore({ file: fs, storage, network })

    let offline = false
    const handler = () => { offline = true }
    core.on('network:offline', handler)
    const results = await core.load()
    core.off('network:offline', handler)

    expect(ado.calls.load).toBe(0)
    expect(offline).toBe(true)
    expect(results).toEqual([])
  })
})
