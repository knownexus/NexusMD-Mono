import { describe, it, expect, beforeEach } from 'vitest'
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
