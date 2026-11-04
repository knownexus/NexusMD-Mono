import { describe, it, expect } from 'vitest'
import {
  migrateToProfileScopeV2, moveTokensToSecureStorage, MIGRATION_V2_MARKER, profileTokenNames,
} from '../../src/modules/profiles/migrate-v2.js'
import * as core from '../../src/index.js'

// A Web Storage stand-in (getItem/setItem/removeItem/key/length), like window.localStorage.
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    _m: m,
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    snapshot: () => Object.fromEntries(m),
  }
}

// Like the real adapter: the value is kept (here "encrypted" as enc:<value>) in the same storage
// under `nexusmd.sec.<name>`, get() is null on a missing or unreadable entry, set() never throws.
function memorySecure(storage, { failSet = () => false } = {}) {
  const P = 'nexusmd.sec.'
  return {
    async get(name) { const raw = storage.getItem(P + name); return raw && raw.startsWith('enc:') ? raw.slice(4) : null },
    async set(name, v) { if (!failSet(name)) storage.setItem(P + name, 'enc:' + v) },
    async remove(name) { storage.removeItem(P + name) },
  }
}

const PROFILES = ['A', 'B']
const run = (storage, secure, extra = {}) => migrateToProfileScopeV2({
  storage, secure, namespace: 'nexusmd', profiles: PROFILES, activeProfileId: 'A', ...extra,
})

// Every global key the desktop wrote before profiles held everything (Task 7's mapping).
const GLOBALS = {
  'nexusmd.tweaks': '{"theme":"dark"}',
  'nexusmd.refreshInterval': '120',
  'nexusmd.markdown.textSize': '15',
  'nexusmd.projectAreas.v3': '[{"id":"a1"}]',
  'nexusmd.confidential.autoRelock': '5',
  'nexusmd.settings.collapsed': '["about"]',
  'nexusmd.outputPath': 'C:\\out',
  'nx-db:list-hidden': 'true',
  'nx-db:last-type': '"sqlite"',
  'nx-db:tables:demo:/': '{"groups":["G"]}',
  'nx-db:starred:uat': '["staff"]',
  'nx-db:min-cols:demo:/:patients': '["name"]',
  'nx-db:other-schemas:uat': 'false',
  'md_learn_mode': 'true',
  'md_cheatsheet_open': 'false',
  'md_learning_progress': '{"h1":true}',
  'nx-gw-branch-commits-collapsed': '1',
  'nexusmd_seen_pr': '[1,2]',
  // content
  'md_documents': '{"docs":[{"id":"d1"}]}',
  'nx-db:saved-queries': '[{"id":"q1"}]',
  'nx-db:open-connections': '{"ids":["c1"],"active":"c1"}',
  'nexusmd.team.notes': '[{"id":"n1"}]',
  'nexusmd.team.custom': '[{"id":"m1","name":"Sam"}]',
  // caches: dropped
  'nexusmd.ado.cache.v1': '{"WORK_ITEMS":[]}',
  'nexusmd.workitems.status.v1': '{}',
  'nexusmd.jira.cache.v1': '{"WORK_ITEMS":[]}',
  'nexusmd.github.cache.v1': '{"WORK_ITEMS":[]}',
}
const SETTINGS = {
  'nexusmd.tweaks': 'tweaks', 'nexusmd.refreshInterval': 'refreshInterval', 'nexusmd.markdown.textSize': 'markdown.textSize',
  'nexusmd.projectAreas.v3': 'projectAreas.v3', 'nexusmd.confidential.autoRelock': 'confidential.autoRelock',
  'nexusmd.settings.collapsed': 'settings.collapsed', 'nexusmd.outputPath': 'outputPath',
  'nx-db:list-hidden': 'dbManager.listHidden', 'nx-db:last-type': 'dbManager.lastType',
  'nx-db:tables:demo:/': 'dbManager.tables.demo:/', 'nx-db:starred:uat': 'dbManager.starred.uat',
  'nx-db:min-cols:demo:/:patients': 'dbManager.minCols.demo:/.patients', 'nx-db:other-schemas:uat': 'dbManager.otherSchemas.uat',
  'md_learn_mode': 'md_learn_mode', 'md_cheatsheet_open': 'md_cheatsheet_open', 'md_learning_progress': 'md_learning_progress',
  'nx-gw-branch-commits-collapsed': 'branchCommitsCollapsed', 'nexusmd_seen_pr': 'seenPr',
}
const CONTENT = {
  'md_documents': 'md_documents', 'nx-db:saved-queries': 'dbManager.savedQueries',
  'nx-db:open-connections': 'dbManager.openConnections', 'nexusmd.team.notes': 'team.notes', 'nexusmd.team.custom': 'team.custom',
}

// The read/write allowlist of apps/desktop/src/no-global-user-keys.test.jsx, plus the marker.
const ALLOWED = [
  /^nexusmd\.p\.[^.]+\./, /^nexusmd\.profiles$/, /^nexusmd\.activeProfileId$/,
  /^nexusmd\.account\./, /^nexusmd\.sec\./, /^nexusmd\.feature\./, /^nexusmd\.sync\./, /^nexusmd\.oauth\.pending$/,
  /^nexusmd\.profileDir$/, /^nexusmd\.migrated\.v2$/,
]

describe('migrateToProfileScopeV2', () => {
  it('is exported from @nexusmd/core', () => {
    expect(core.migrateToProfileScopeV2).toBe(migrateToProfileScopeV2)
    expect(MIGRATION_V2_MARKER).toBe('nexusmd.migrated.v2')
  })

  it('settings are copied to every profile; content and credentials only to the active one', async () => {
    const storage = memoryStorage({ ...GLOBALS, 'nexusmd.sec.nexusmd.apiClient.secret.col.dev.token': 'enc:s3cret' })
    const secure = memorySecure(storage)
    const { moved } = await run(storage, secure)
    for (const [from, name] of Object.entries(SETTINGS)) {
      for (const pid of PROFILES) expect(storage.getItem(`nexusmd.p.${pid}.${name}`), `${from} -> ${pid}`).toBe(GLOBALS[from])
      expect(storage.getItem(from), from).toBeNull()
    }
    for (const [from, name] of Object.entries(CONTENT)) {
      expect(storage.getItem(`nexusmd.p.A.${name}`), from).toBe(GLOBALS[from])
      expect(storage.getItem(`nexusmd.p.B.${name}`), from).toBeNull()
      expect(storage.getItem(from), from).toBeNull()
    }
    expect(await secure.get('nexusmd.p.A.apiClient.secret.col.dev.token')).toBe('s3cret')
    expect(await secure.get('nexusmd.p.B.apiClient.secret.col.dev.token')).toBeNull()
    expect(await secure.get('nexusmd.apiClient.secret.col.dev.token')).toBeNull()
    // The caches are not carried: they rebuild under the profile.
    expect(storage.getItem('nexusmd.ado.cache.v1')).toBeNull()
    expect(storage.getItem('nexusmd.workitems.status.v1')).toBeNull()
    expect(storage.getItem('nexusmd.p.A.ado.cache.v1')).toBeNull()
    for (const k of ['jira', 'github']) {
      expect(storage.getItem(`nexusmd.${k}.cache.v1`)).toBeNull()
      expect(storage.getItem(`nexusmd.p.A.${k}.cache.v1`)).toBeNull()
    }
    expect(storage.getItem(MIGRATION_V2_MARKER)).toBe('1')
    expect(moved).toContain('md_documents')
    expect(moved).toContain('nexusmd.tweaks')
  })

  it('an existing profile-scoped value wins over the global one', async () => {
    const storage = memoryStorage({
      'nexusmd.tweaks': '{"theme":"dark"}', 'nexusmd.p.B.tweaks': '{"theme":"light"}',
      'md_documents': '{"docs":[{"id":"old"}]}', 'nexusmd.p.A.md_documents': '{"docs":[{"id":"new"}]}',
      'nexusmd.sec.nexusmd.apiClient.secret.c.e.v': 'enc:global', 'nexusmd.sec.nexusmd.p.A.apiClient.secret.c.e.v': 'enc:scoped',
    })
    const secure = memorySecure(storage)
    await run(storage, secure)
    expect(storage.getItem('nexusmd.p.B.tweaks')).toBe('{"theme":"light"}')
    expect(storage.getItem('nexusmd.p.A.tweaks')).toBe('{"theme":"dark"}')
    expect(storage.getItem('nexusmd.p.A.md_documents')).toBe('{"docs":[{"id":"new"}]}')
    expect(await secure.get('nexusmd.p.A.apiClient.secret.c.e.v')).toBe('scoped')
    expect(storage.getItem('nexusmd.tweaks')).toBeNull()
    expect(storage.getItem('md_documents')).toBeNull()
    // Content that lost to the profile's own copy is not thrown away: it is kept on this
    // machine only (never synced) under a backup key.
    expect(storage.getItem('nexusmd.migrated.v2.backup.md_documents')).toBe('{"docs":[{"id":"old"}]}')
    // A differing global secret stays where it was rather than being lost.
    expect(await secure.get('nexusmd.apiClient.secret.c.e.v')).toBe('global')
  })

  it('a second backup of the same key never replaces the first', async () => {
    const storage = memoryStorage({
      'md_documents': 'second', 'nexusmd.p.A.md_documents': 'mine',
      'nexusmd.migrated.v2.backup.md_documents': 'first',
    })
    await run(storage, memorySecure(storage))
    expect(storage.getItem('nexusmd.migrated.v2.backup.md_documents')).toBe('first')
    expect(storage.getItem('nexusmd.migrated.v2.backup.md_documents.2')).toBe('second')
  })

  it('an equal scoped copy leaves no backup behind', async () => {
    const storage = memoryStorage({ 'md_documents': '{"docs":[]}', 'nexusmd.p.A.md_documents': '{"docs":[]}' })
    await run(storage, memorySecure(storage))
    expect(storage.getItem('md_documents')).toBeNull()
    expect(storage.getItem('nexusmd.migrated.v2.backup.md_documents')).toBeNull()
  })

  it('team.custom raw list merges into the scoped list by id', async () => {
    const storage = memoryStorage({
      'nexusmd.team.custom': JSON.stringify([{ id: 'm1', name: 'Old Sam' }, { id: 'm2', name: 'Ann' }]),
      'nexusmd.p.A.team.custom': JSON.stringify([{ id: 'm1', name: 'Sam' }, { id: 'm3', name: 'Lee' }]),
    })
    await run(storage, memorySecure(storage))
    expect(JSON.parse(storage.getItem('nexusmd.p.A.team.custom'))).toEqual([
      { id: 'm1', name: 'Sam' }, { id: 'm3', name: 'Lee' }, { id: 'm2', name: 'Ann' },
    ])
    expect(storage.getItem('nexusmd.team.custom')).toBeNull()
    expect(storage.getItem('nexusmd.p.B.team.custom')).toBeNull()
  })

  it('an unreadable team.custom is never merged away', async () => {
    const storage = memoryStorage({ 'nexusmd.team.custom': '{nope', 'nexusmd.p.A.team.custom': '[{"id":"m1"}]' })
    await run(storage, memorySecure(storage))
    expect(storage.getItem('nexusmd.p.A.team.custom')).toBe('[{"id":"m1"}]')
    expect(storage.getItem('nexusmd.migrated.v2.backup.nexusmd.team.custom')).toBe('{nope')
  })

  it('min-cols keys split the table off the last colon', async () => {
    const storage = memoryStorage({ 'nx-db:min-cols:mssql:srv:1433/db:dbo.t': '["a"]' })
    await run(storage, memorySecure(storage))
    expect(storage.getItem('nexusmd.p.A.dbManager.minCols.mssql:srv:1433/db.dbo.t')).toBe('["a"]')
    expect(storage.getItem('nexusmd.p.B.dbManager.minCols.mssql:srv:1433/db.dbo.t')).toBe('["a"]')
  })

  it('plain tokens move into secure storage and the plain keys are gone', async () => {
    const storage = memoryStorage({
      'nexusmd.p.A.ado.pat': 'ado-A', 'nexusmd.p.B.github.pat': 'gh-B', 'nexusmd.p.A.jira.apiToken': 'jira-A',
      'nexusmd.p.A.gdrive.auth': '{"accessToken":"g"}', 'nexusmd.p.B.microsoft.auth': '{"accessToken":"m"}',
      'nexusmd.p.A.ado.org': 'contoso',
    })
    const secure = memorySecure(storage)
    await run(storage, secure)
    expect(await secure.get('nexusmd.p.A.ado.pat')).toBe('ado-A')
    expect(await secure.get('nexusmd.p.B.github.pat')).toBe('gh-B')
    expect(await secure.get('nexusmd.p.A.jira.apiToken')).toBe('jira-A')
    expect(await secure.get('nexusmd.p.A.gdrive.auth')).toBe('{"accessToken":"g"}')
    expect(await secure.get('nexusmd.p.B.microsoft.auth')).toBe('{"accessToken":"m"}')
    for (const k of ['nexusmd.p.A.ado.pat', 'nexusmd.p.B.github.pat', 'nexusmd.p.A.jira.apiToken', 'nexusmd.p.A.gdrive.auth', 'nexusmd.p.B.microsoft.auth']) {
      expect(storage.getItem(k), k).toBeNull()
    }
    expect(storage.getItem('nexusmd.p.A.ado.org')).toBe('contoso') // not a token
  })

  it('a token already in secure storage wins and the plain copy goes', async () => {
    const storage = memoryStorage({ 'nexusmd.p.A.ado.pat': 'old', 'nexusmd.sec.nexusmd.p.A.ado.pat': 'enc:new' })
    const secure = memorySecure(storage)
    await run(storage, secure)
    expect(await secure.get('nexusmd.p.A.ado.pat')).toBe('new')
    expect(storage.getItem('nexusmd.p.A.ado.pat')).toBeNull()
  })

  it('a token whose secure write did not stick keeps its plain key, and nothing else moves', async () => {
    const storage = memoryStorage({ 'nexusmd.p.A.ado.pat': 'ado-A', 'nexusmd.tweaks': '{"theme":"dark"}' })
    const secure = memorySecure(storage, { failSet: n => n === 'nexusmd.p.A.ado.pat' })
    const before = storage.snapshot()
    await expect(run(storage, secure)).rejects.toThrow(/nexusmd\.p\.A\.ado\.pat/)
    expect(storage.snapshot()).toEqual(before)
    expect(storage.getItem(MIGRATION_V2_MARKER)).toBeNull()
  })

  it('a failure while copying leaves the data as it was and sets no marker', async () => {
    const storage = memoryStorage({ ...GLOBALS })
    const realSet = storage.setItem
    let n = 0
    storage.setItem = (k, v) => { if (++n === 5) throw new Error('quota'); realSet(k, v) }
    const before = storage.snapshot()
    await expect(run(storage, memorySecure(storage))).rejects.toThrow('quota')
    expect(storage.snapshot()).toEqual(before)
    expect(storage.getItem(MIGRATION_V2_MARKER)).toBeNull()
  })

  it('running twice changes nothing the second time', async () => {
    const storage = memoryStorage({ ...GLOBALS, 'nexusmd.p.A.ado.pat': 'ado-A' })
    const secure = memorySecure(storage)
    await run(storage, secure)
    const after = storage.snapshot()
    const second = await run(storage, secure)
    expect(second.moved).toEqual([])
    expect(storage.snapshot()).toEqual(after)
  })

  it('does nothing, and sets no marker, without an active profile', async () => {
    const storage = memoryStorage({ ...GLOBALS })
    const before = storage.snapshot()
    expect((await run(storage, memorySecure(storage), { profiles: [], activeProfileId: '' })).moved).toEqual([])
    expect((await run(storage, memorySecure(storage), { activeProfileId: 'Z' })).moved).toEqual([])
    expect(storage.snapshot()).toEqual(before)
  })

  it('afterwards no global user-data key remains', async () => {
    const storage = memoryStorage({
      ...GLOBALS,
      'nexusmd.profiles': '[{"id":"A"},{"id":"B"}]', 'nexusmd.activeProfileId': 'A',
      'nexusmd.account.deviceId': 'd', 'nexusmd.feature.x': '1', 'nexusmd.profileDir': 'C:\\p',
      'nexusmd.sec.nexusmd.apiClient.secret.c.e.v': 'enc:x', 'nexusmd.p.A.ado.pat': 'pat',
    })
    await run(storage, memorySecure(storage))
    const left = Object.keys(storage.snapshot()).filter(k => !ALLOWED.some(re => re.test(k)))
    expect(left).toEqual([])
    expect(Object.keys(storage.snapshot()).filter(k => /^nexusmd\.sec\.nexusmd\.apiClient\./.test(k))).toEqual([])
  })
})

describe('moveTokensToSecureStorage', () => {
  it('runs without the marker (an imported profile can bring plain tokens back)', async () => {
    const storage = memoryStorage({ [MIGRATION_V2_MARKER]: '1', 'nexusmd.p.A.github.pat': 'gh' })
    const secure = memorySecure(storage)
    expect((await moveTokensToSecureStorage({ storage, secure, namespace: 'nexusmd' })).moved).toEqual(['nexusmd.p.A.github.pat'])
    expect(await secure.get('nexusmd.p.A.github.pat')).toBe('gh')
    expect(storage.getItem('nexusmd.p.A.github.pat')).toBeNull()
  })

  it('profileTokenNames lists every token of a profile by its secure-storage name', () => {
    expect(profileTokenNames('nexusmd', 'A')).toEqual([
      'nexusmd.p.A.ado.pat', 'nexusmd.p.A.github.pat', 'nexusmd.p.A.jira.apiToken',
      'nexusmd.p.A.gdrive.auth', 'nexusmd.p.A.onedrive.auth', 'nexusmd.p.A.ado.auth',
      'nexusmd.p.A.microsoft.auth', 'nexusmd.p.A.github.auth', 'nexusmd.p.A.google.auth',
    ])
  })
})
