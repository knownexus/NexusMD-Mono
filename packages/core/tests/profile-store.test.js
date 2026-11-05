import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerModule, clearRegistry } from '../src/features/module-registry.js'
import {
  createProfile, activateProfile, deleteProfile, importProfile, exportProfile, listProfiles,
} from '../src/profiles/profile-store.js'
import { buildProfile, generateProfileId, validateProfile } from '../src/profiles/profile-schema.js'

// ── In-memory adapter mocks ─────────────────────────────────────────────────
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
  return {
    map: m,
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, v) },
    remove: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}

describe('buildProfile / generateProfileId', () => {
  it('builds a schema-valid profile from just a name', () => {
    const p = buildProfile({ name: 'Work' })
    expect(validateProfile(p)).toEqual({ valid: true })
    expect(p.name).toBe('Work')
    expect(p.version).toBe(1)
    expect(typeof p.id).toBe('string')
    expect(p.modules.planner.enabled).toBe(true)
    expect(p.modules.ado.enabled).toBe(false)
  })

  it('merges supplied module config over defaults', () => {
    const p = buildProfile({ name: 'W', modules: { ado: { enabled: true, org: 'acme' } } })
    expect(p.modules.ado).toEqual({ enabled: true, org: 'acme' })
    expect(p.modules.team.enabled).toBe(true) // default preserved
  })

  it('honours a supplied id and created timestamp', () => {
    const p = buildProfile({ name: 'W', id: 'fixed', created: '2020-01-01T00:00:00Z' })
    expect(p.id).toBe('fixed')
    expect(p.created).toBe('2020-01-01T00:00:00Z')
  })

  it('generateProfileId returns distinct non-empty strings', () => {
    const a = generateProfileId(), b = generateProfileId()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })
})

describe('createProfile', () => {
  it('writes a valid {id}.json to the profile dir and returns the profile', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work', type: 'ado' })
    expect(fs.files.has(`/profiles/${p.id}.json`)).toBe(true)
    const written = JSON.parse(fs.files.get(`/profiles/${p.id}.json`))
    expect(written.name).toBe('Work')
    expect(validateProfile(written)).toEqual({ valid: true })
  })

  it('honours a custom profile dir from storage', async () => {
    const fs = makeFs(), storage = makeStorage({ 'nexusmd.profileDir': '/custom' })
    const p = await createProfile(fs, storage, { name: 'Work' })
    expect(fs.files.has(`/custom/${p.id}.json`)).toBe(true)
  })

  it('round-trips through listProfiles', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    const all = await listProfiles(fs, storage)
    expect(all.map(x => x.id)).toContain(p.id)
  })
})

describe('deleteProfile', () => {
  it('removes the file and clears the active id when it was active', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    storage.set('nexusmd.activeProfileId', p.id)
    await deleteProfile(p.id, fs, storage)
    expect(fs.files.has(`/profiles/${p.id}.json`)).toBe(false)
    expect(storage.get('nexusmd.activeProfileId')).toBeNull()
  })

  it('clears the profile secrets via secureStorage', async () => {
    const fs = makeFs(), storage = makeStorage()
    const removed = []
    const secure = { remove: async (k) => { removed.push(k) } }
    const p = await createProfile(fs, storage, { name: 'Work' })
    await deleteProfile(p.id, fs, storage, secure)
    expect(removed).toContain(`nexusmd.ado.pat.${p.id}`)
    expect(removed).toContain(`nexusmd.github.pat.${p.id}`)
  })

  it('leaves a different active id untouched', async () => {
    const fs = makeFs(), storage = makeStorage()
    const a = await createProfile(fs, storage, { name: 'A' })
    const b = await createProfile(fs, storage, { name: 'B' })
    storage.set('nexusmd.activeProfileId', b.id)
    await deleteProfile(a.id, fs, storage)
    expect(storage.get('nexusmd.activeProfileId')).toBe(b.id)
  })
})

describe('activateProfile', () => {
  it('persists the active id', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    await activateProfile(p.id, fs, storage)
    expect(storage.get('nexusmd.activeProfileId')).toBe(p.id)
  })

  it('returns the activated profile object', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    const activated = await activateProfile(p.id, fs, storage)
    expect(activated.id).toBe(p.id)
  })

  it('returns null when the profile file is missing', async () => {
    const fs = makeFs(), storage = makeStorage()
    const activated = await activateProfile('ghost', fs, storage)
    expect(activated).toBeNull()
    expect(storage.get('nexusmd.activeProfileId')).toBe('ghost')
  })
})

describe('importProfile', () => {
  it('returns null when the user cancels', async () => {
    const fs = makeFs(), storage = makeStorage()
    const picker = { pickFile: async () => null }
    expect(await importProfile(fs, storage, picker)).toBeNull()
  })

  it('writes a valid imported profile', async () => {
    const fs = makeFs(), storage = makeStorage()
    const incoming = buildProfile({ name: 'Imported', id: 'imp1' })
    const picker = { pickFile: async () => JSON.stringify(incoming) }
    const result = await importProfile(fs, storage, picker)
    expect(result.id).toBe('imp1')
    expect(fs.files.has('/profiles/imp1.json')).toBe(true)
  })

  it('assigns a fresh id when the imported id already exists', async () => {
    const fs = makeFs(), storage = makeStorage()
    const existing = await createProfile(fs, storage, { name: 'Existing', id: 'dup' })
    const picker = { pickFile: async () => JSON.stringify(buildProfile({ name: 'Clash', id: 'dup' })) }
    const result = await importProfile(fs, storage, picker)
    expect(result.id).not.toBe('dup')
    expect(fs.files.has(`/profiles/${result.id}.json`)).toBe(true)
    expect(fs.files.has('/profiles/dup.json')).toBe(true) // original untouched
  })

  it('rejects an invalid profile', async () => {
    const fs = makeFs(), storage = makeStorage()
    const picker = { pickFile: async () => JSON.stringify({ not: 'a profile' }) }
    await expect(importProfile(fs, storage, picker)).rejects.toThrow()
  })
})

describe('exportProfile', () => {
  it('saves the profile JSON under a filename derived from its name', async () => {
    let saved = null
    const picker = { saveFile: async (name, text) => { saved = { name, text } } }
    const p = buildProfile({ name: 'My Work Profile' })
    const name = await exportProfile(p, picker)
    expect(name).toBe('My_Work_Profile.json')
    expect(saved.name).toBe('My_Work_Profile.json')
    expect(JSON.parse(saved.text).id).toBe(p.id)
  })
})

// A failure in here must leave a trace: the code carries on, and the log says what failed and where.
describe('profile-store logs the failures it carries on through', () => {
  let error, warn, debug
  const seen = spy => spy.mock.calls.map(c => c[0])
  beforeEach(() => {
    clearRegistry()
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  afterEach(() => { clearRegistry(); vi.restoreAllMocks() })

  it('a module that fails to start is logged under its own id, and the others still start', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    const good = vi.fn()
    registerModule({ id: 'bad', defaultEnabled: true, init: () => { throw new Error('init boom') } })
    registerModule({ id: 'good', defaultEnabled: true, init: good })
    const activated = await activateProfile(p.id, fs, storage, {})
    expect(activated.id).toBe(p.id)
    expect(good).toHaveBeenCalled()
    expect(seen(error)).toEqual(['[bad:init] module init failed'])
    expect(error.mock.calls[0][1].message).toBe('init boom')
  })

  it('a module that fails to shut down is logged under its own id, and the others still shut down', async () => {
    const fs = makeFs(), storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    const dispose = vi.fn()
    registerModule({ id: 'stuck', defaultEnabled: true, dispose: () => { throw new Error('dispose boom') } })
    registerModule({ id: 'fine', defaultEnabled: true, dispose })
    await activateProfile(p.id, fs, storage)           // enables both
    await activateProfile(p.id, fs, storage)           // disposes both, then starts again
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(seen(error)).toEqual(['[stuck:dispose] module dispose failed'])
  })

  it('says so when the profile file cannot be read, and still activates with no profile', async () => {
    const fs = makeFs(), storage = makeStorage()
    expect(await activateProfile('ghost', fs, storage)).toBeNull()
    expect(seen(warn)).toEqual(['[core:profiles] ignored: could not read the profile file, activating without it'])
  })

  it('names the profile file it skips when listing', async () => {
    const fs = makeFs({ '/profiles/broken.json': '{ not json', '/profiles/ok.json': JSON.stringify(buildProfile({ name: 'Ok', id: 'ok' })) })
    const list = await listProfiles(fs, makeStorage())
    expect(list.map(p => p.id)).toEqual(['ok'])
    expect(seen(warn)).toEqual(['[core:profiles] ignored: skipped an unreadable profile file'])
    expect(warn.mock.calls[0][2]).toEqual({ file: 'broken.json' })
  })

  it('logs, but does not stop on, a folder that cannot be created or a secret that cannot be removed', async () => {
    const fs = { ...makeFs(), mkdir: async () => { throw new Error('exists') } }
    const storage = makeStorage()
    const p = await createProfile(fs, storage, { name: 'Work' })
    expect(seen(debug)).toEqual(['[core:profiles] ignored: creating the profile folder (it may already exist)'])
    const secure = { remove: async () => { throw new Error('locked') } }
    await deleteProfile(p.id, fs, storage, secure)
    expect(seen(warn)).toEqual([
      '[core:profiles] ignored: removing a saved token for the deleted profile',
      '[core:profiles] ignored: removing a saved token for the deleted profile',
    ])
  })

  it('logs, but does not stop on, an active id that cannot be cleared', async () => {
    const fs = makeFs()
    const storage = { ...makeStorage({ 'nexusmd.activeProfileId': 'p1' }), remove: () => { throw new Error('read-only') } }
    const p = await createProfile(fs, storage, { name: 'Work', id: 'p1' })
    await deleteProfile(p.id, fs, storage)
    expect(seen(warn)).toEqual(['[core:profiles] ignored: clearing the active profile id'])
  })
})
