import { describe, it, expect } from 'vitest'
import {
  createKeyRegistry, TWEAK_ACCOUNT_FIELDS, ALIASES, SYNC_SKIP, isSkippedKey,
} from '../src/modules/account/key-registry.js'
import * as core from '../src/index.js'

const desktop = () => createKeyRegistry({ namespace: 'nexusmd' })
const android = () => createKeyRegistry({ namespace: 'helm' })

describe('createKeyRegistry', () => {
  it('rejects an unknown namespace', () => {
    expect(() => createKeyRegistry({ namespace: 'other' })).toThrow()
    expect(() => createKeyRegistry()).toThrow()
  })

  it('exposes namespace and secPrefix', () => {
    expect(desktop().namespace).toBe('nexusmd')
    expect(desktop().secPrefix).toBe('nexusmd.sec.')
    expect(android().namespace).toBe('helm')
    expect(android().secPrefix).toBe('helm.sec.')
  })
})

describe('skip rules', () => {
  const never = [
    'nexusmd.sec.x',
    'nexusmd.sync.base.y',
    'nexusmd.p.1.git.snapshot',
    'nexusmd.planner.week.2026-W40',
    'nexusmd.p.1.planner.week.2026-W40',
    'nexusmd.planner.globalNotes',
    'nexusmd.p.1.planner.globalNotes',
    'nexusmd.planner.versions',
    'nexusmd.account.meta',
    'nexusmd.account.deviceId',
    'nexusmd.sec.account.keys',
    'nexusmd.p.1.calendar.events',
    'nexusmd.lists',
    'nexusmd.p.1.lists',
    'nexusmd.timelog.v1',
    'nexusmd.oauth.pending',
    'nexusmd.ado.cache.v1',
    'nexusmd.workitems.status.v2',
    'nexusmd.p.1.ado.wiTypeDefs.proj.Bug',
    'helm.sec.x',
    'helm.sync.base.y',
    'helm.oauth.pending',
    'helm.p.1.git.snapshot',
    'helm.planner.week.2026-W40',
    'helm.planner',
    'helm.p.1.planner',
    'helm.lists',
    'helm.p.1.lists',
    'helm.account.meta',
    'helm.sec.account.keys',
    'helm.workitems.status.v1',
    // queued unsent mutations must not replay on another device
    'helm.offlineQueue',
    'helm.p.1.offlineQueue',
    // large virtual-file blobs and device-bound SAF URIs, bare and profile-scoped
    'helm.android.editorfs:/notes/a.md',
    'helm.p.1.android.editorfs:/notes/a.md',
    'helm.android.apifs:coll/req.json',
    'helm.p.1.android.apifs:coll/req.json',
    'helm.android.editor.safFolders',
    'helm.p.1.android.editor.safFolders',
    // device-local migration markers
    'helm.migrated',
    'helm.planner.legacyMigrated',
    'helm.p.1.planner.legacyMigrated',
    'nexusmd.migrated',
  ]
  it.each(never)('classify(%s) is null', (key) => {
    const reg = key.startsWith('helm.') ? android() : desktop()
    expect(reg.classify(key)).toBeNull()
  })

  it('does not classify keys outside its own namespace', () => {
    expect(desktop().classify('helm.theme')).toBeNull()
    expect(android().classify('nexusmd.theme')).toBeNull()
    expect(desktop().classify('unrelated')).toBeNull()
  })

  it('shared skip list is namespace-aware', () => {
    expect(isSkippedKey('nexusmd.sec.a')).toBe(true)
    expect(isSkippedKey('helm.sec.a')).toBe(true)
    expect(isSkippedKey('helm.oauth.pending')).toBe(true)
    expect(isSkippedKey('nexusmd.theme')).toBe(false)
    expect(isSkippedKey('helm.theme')).toBe(false)
    expect(SYNC_SKIP.every(re => re instanceof RegExp)).toBe(true)
  })

  it('toStorageKey never produces an excluded key', () => {
    expect(desktop().toStorageKey('nexusmd:sec.x')).toBeNull()
    expect(desktop().toStorageKey('nexusmd:account.meta')).toBeNull()
    expect(desktop().toStorageKey('nexusmd:planner.week.2026-W40')).toBeNull()
    expect(desktop().toStorageKey('p.1.ado.cache.v1')).toBeNull()
  })
})

describe('profiles and active profile', () => {
  it.each([['nexusmd', desktop], ['helm', android]])('%s profiles and activeProfileId', (ns, make) => {
    const reg = make()
    expect(reg.classify(`${ns}.profiles`)).toEqual({ id: 'profiles', level: 'account' })
    expect(reg.classify(`${ns}.activeProfileId`)).toEqual({ id: 'activeProfileId', level: 'device' })
    expect(reg.toStorageKey('profiles')).toBe(`${ns}.profiles`)
    expect(reg.toStorageKey('activeProfileId')).toBe(`${ns}.activeProfileId`)
  })

  it('migration markers are not synced', () => {
    expect(android().classify('helm.migrated')).toBeNull()
    expect(android().classify('helm.planner.legacyMigrated')).toBeNull()
  })
})

describe('aliases', () => {
  it('ado org is shared between desktop and Android', () => {
    const d = desktop().classify('nexusmd.p.1.ado.org')
    const a = android().classify('helm.p.1.android.org')
    expect(d).toEqual({ id: 'p.1.ado.org', level: 'account' })
    expect(a).toEqual(d)
    expect(desktop().toStorageKey(d.id)).toBe('nexusmd.p.1.ado.org')
    expect(android().toStorageKey(d.id)).toBe('helm.p.1.android.org')
  })

  it('github and jira fields use each platform key scheme', () => {
    expect(desktop().classify('nexusmd.p.9.github.pat').id).toBe(android().classify('helm.p.9.android.github.pat').id)
    expect(desktop().classify('nexusmd.p.9.jira.apiToken').id).toBe(android().classify('helm.p.9.android.jira.apiToken').id)
  })

  it('the other platform key shape is not an alias in this namespace', () => {
    // desktop has no android.* keys; on desktop that would be a private key
    expect(desktop().classify('nexusmd.p.1.android.org').id).toBe('nexusmd:p.1.android.org')
    expect(android().classify('helm.p.1.ado.org').id).toBe('helm:p.1.ado.org')
  })

  it('has verified rows for ADO, GitHub and Jira, and no duplicates', () => {
    const ids = ALIASES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ALIASES.map(r => r.nexusmd)).size).toBe(ALIASES.length)
    expect(new Set(ALIASES.map(r => r.helm)).size).toBe(ALIASES.length)
    for (const name of ['org', 'pat', 'projects', 'testProject', 'uatProject', 'uatPipelineId', 'uatBranch', 'refreshSecs', 'workItems']) {
      expect(ALIASES).toContainEqual({ id: `ado.${name}`, nexusmd: `ado.${name}`, helm: `android.${name}` })
    }
    for (const name of ['pat', 'repos', 'issues', 'inWork', 'login', 'refreshSecs']) {
      expect(ALIASES).toContainEqual({ id: `github.${name}`, nexusmd: `github.${name}`, helm: `android.github.${name}` })
    }
    for (const name of ['site', 'email', 'apiToken', 'projectKeys', 'jql', 'boardId', 'enabled', 'refreshSecs']) {
      expect(ALIASES).toContainEqual({ id: `jira.${name}`, nexusmd: `jira.${name}`, helm: `android.jira.${name}` })
    }
  })

  describe.each(ALIASES.map(r => [r.id, r]))('row %s', (_id, row) => {
    it.each([['profile-scoped', 'p.abc.'], ['unscoped', '']])('%s: classify and round-trip on both platforms', (_label, scope) => {
      const dKey = `nexusmd.${scope}${row.nexusmd}`
      const aKey = `helm.${scope}${row.helm}`
      const d = desktop().classify(dKey)
      const a = android().classify(aKey)
      expect(d).not.toBeNull()
      expect(d).toEqual(a)
      expect(d.id).toBe(`${scope}${row.id}`)
      expect(d.level).toBe('account')
      expect(desktop().toStorageKey(d.id)).toBe(dKey)
      expect(android().toStorageKey(d.id)).toBe(aKey)
    })
  })
})

describe('platform-private keys', () => {
  it('google tokens keep their namespace and never cross platforms', () => {
    const d = desktop().classify('nexusmd.p.1.google.auth')
    const a = android().classify('helm.p.1.google.auth')
    expect(d).toEqual({ id: 'nexusmd:p.1.google.auth', level: 'account' })
    expect(a).toEqual({ id: 'helm:p.1.google.auth', level: 'account' })
    expect(d.id).not.toBe(a.id)
    expect(desktop().toStorageKey(d.id)).toBe('nexusmd.p.1.google.auth')
    expect(android().toStorageKey(a.id)).toBe('helm.p.1.google.auth')
    expect(desktop().toStorageKey(a.id)).toBeNull()
    expect(android().toStorageKey(d.id)).toBeNull()
  })

  it('ado tokens (ado.auth) are not aliased', () => {
    expect(desktop().classify('nexusmd.p.1.ado.auth').id).toBe('nexusmd:p.1.ado.auth')
  })

  it('unaliased account-level keys round trip within the namespace', () => {
    const c = desktop().classify('nexusmd.p.1.team.custom')
    expect(c).toEqual({ id: 'nexusmd:p.1.team.custom', level: 'account' })
    expect(desktop().toStorageKey(c.id)).toBe('nexusmd.p.1.team.custom')
    expect(desktop().classify('nexusmd.theme')).toEqual({ id: 'nexusmd:theme', level: 'account' })
  })

  it('toStorageKey accepts only the canonical id classify produces', () => {
    const d = desktop(), a = android()
    // non-canonical spellings of keys that classify to another id
    expect(d.toStorageKey('nexusmd:tweaks')).toBeNull()
    expect(d.toStorageKey('nexusmd:p.1.tweaks')).toBeNull()
    expect(d.toStorageKey('nexusmd:profiles')).toBeNull()
    expect(d.toStorageKey('nexusmd:activeProfileId')).toBeNull()
    expect(d.toStorageKey('nexusmd:p.1.ado.org')).toBeNull()
    expect(d.toStorageKey('nexusmd:ado.org')).toBeNull()
    expect(a.toStorageKey('helm:p.1.android.org')).toBeNull()
    expect(a.toStorageKey('helm:p.1.android.github.pat')).toBeNull()
    // canonical forms still work
    expect(d.toStorageKey('p.1.ado.org')).toBe('nexusmd.p.1.ado.org')
    expect(d.toStorageKey('nexusmd:p.1.ado.auth')).toBe('nexusmd.p.1.ado.auth')
    expect(a.toStorageKey('tweaks.device')).toBe('helm.tweaks')
  })

  it('every id classify produces round-trips exactly', () => {
    const keys = [
      ['nexusmd', 'nexusmd.profiles'], ['nexusmd', 'nexusmd.activeProfileId'], ['nexusmd', 'nexusmd.p.1.ado.org'],
      ['nexusmd', 'nexusmd.p.1.google.auth'], ['nexusmd', 'nexusmd.sidebar.width'], ['helm', 'helm.p.1.android.jira.site'],
      ['helm', 'helm.p.1.google.auth'], ['helm', 'helm.theme'],
    ]
    for (const [ns, key] of keys) {
      const reg = ns === 'helm' ? android() : desktop()
      expect(reg.toStorageKey(reg.classify(key).id)).toBe(key)
    }
  })

  it('unknown neutral ids return null', () => {
    expect(desktop().toStorageKey('p.1.ado.nothing')).toBeNull()
    expect(desktop().toStorageKey('')).toBeNull()
    expect(desktop().toStorageKey(null)).toBeNull()
  })
})

describe('device-level keys', () => {
  const deviceKeys = [
    'sidebar.width', 'fields.wiCard', 'fields.buildsTable', 'builds.collapsed', 'builds.sortDir',
    'builds.hiddenCols', 'builds.colOrder', 'builds.statuses', 'wi.view', 'wi.collapsed.board',
    'wi.assignees.neg', 'notif.digest', 'refreshInterval', 'markdown.textSize',
  ]
  it.each(deviceKeys)('%s is device level, plain and profile-scoped', (name) => {
    expect(desktop().classify(`nexusmd.${name}`)).toEqual({ id: `nexusmd:${name}`, level: 'device' })
    expect(desktop().classify(`nexusmd.p.7.${name}`)).toEqual({ id: `nexusmd:p.7.${name}`, level: 'device' })
    expect(android().classify(`helm.p.7.${name}`)).toEqual({ id: `helm:p.7.${name}`, level: 'device' })
  })

  it('other builds and wi neighbours default to account level', () => {
    expect(desktop().classify('nexusmd.builds.acknowledged').level).toBe('account')
    expect(desktop().classify('nexusmd.builds.hiddenPipelines').level).toBe('account')
    expect(desktop().classify('nexusmd.ui.drawerWidth').level).toBe('account')
  })
})

describe('tweaks', () => {
  it('has the exact account field list', () => {
    expect(TWEAK_ACCOUNT_FIELDS).toEqual([
      'theme', 'lightTheme', 'dimTheme', 'darkTheme', 'density', 'typeLabels', 'quickLinks', 'showMarkdown',
    ])
  })

  it('classifies desktop (global) and Android (profile-scoped) tweaks as a split', () => {
    const want = { id: 'tweaks.account', level: 'account', split: true, accountId: 'tweaks.account', deviceId: 'tweaks.device' }
    expect(desktop().classify('nexusmd.tweaks')).toEqual(want)
    expect(desktop().classify('nexusmd.p.1.tweaks')).toEqual(want)
    expect(android().classify('helm.tweaks')).toEqual(want)
    expect(android().classify('helm.p.1.tweaks')).toEqual(want)
  })

  it('toStorageKey for both tweak ids is the namespace tweaks key', () => {
    expect(desktop().toStorageKey('tweaks.account')).toBe('nexusmd.tweaks')
    expect(desktop().toStorageKey('tweaks.device')).toBe('nexusmd.tweaks')
    expect(android().toStorageKey('tweaks.account')).toBe('helm.tweaks')
  })

  it('Android tweaks follow the active profile when one is known', () => {
    const reg = createKeyRegistry({ namespace: 'helm', getActiveProfileId: () => 'abc' })
    expect(reg.toStorageKey('tweaks.account')).toBe('helm.p.abc.tweaks')
    expect(reg.toStorageKey('tweaks.device')).toBe('helm.p.abc.tweaks')
    expect(reg.classify('helm.p.abc.tweaks').split).toBe(true)
    // another profile's tweaks would collide on the same id, so they are not synced
    expect(reg.classify('helm.p.zzz.tweaks')).toBeNull()
    // a leftover bare key is ambiguous once an active profile is known
    expect(reg.classify('helm.tweaks')).toBeNull()
    const none = createKeyRegistry({ namespace: 'helm', getActiveProfileId: () => '' })
    expect(none.toStorageKey('tweaks.account')).toBe('helm.tweaks')
    expect(none.classify('helm.tweaks').split).toBe(true)
    expect(none.classify('helm.p.abc.tweaks')).toBeNull()
  })

  it('without getActiveProfileId any tweaks key shape is accepted', () => {
    const reg = createKeyRegistry({ namespace: 'helm' })
    expect(reg.classify('helm.tweaks').split).toBe(true)
    expect(reg.classify('helm.p.zzz.tweaks').split).toBe(true)
  })

  it('desktop with an active profile accepts only the global tweaks key', () => {
    const reg = createKeyRegistry({ namespace: 'nexusmd', getActiveProfileId: () => 'abc' })
    expect(reg.classify('nexusmd.tweaks').split).toBe(true)
    expect(reg.classify('nexusmd.p.abc.tweaks')).toBeNull()
  })

  it('desktop tweaks stay at the global key even with an active profile', () => {
    const reg = createKeyRegistry({ namespace: 'nexusmd', getActiveProfileId: () => 'abc' })
    expect(reg.toStorageKey('tweaks.account')).toBe('nexusmd.tweaks')
  })

  it('splitTweaks puts account fields in account and everything else, unknown included, in device', () => {
    const reg = desktop()
    const t = {
      theme: 'dark', density: 'compact', quickLinks: ['a'], showMarkdown: true,
      lightTheme: 'l', dimTheme: 'd', darkTheme: 'k', typeLabels: { Bug: 'B' },
      sidebarWidth: 200, someFutureField: 1, accent: 'red',
    }
    const { account, device } = reg.splitTweaks(t)
    expect(Object.keys(account).sort()).toEqual([...TWEAK_ACCOUNT_FIELDS].sort())
    expect(device).toEqual({ sidebarWidth: 200, someFutureField: 1, accent: 'red' })
  })

  it('split then merge round trips and keeps local-only fields', () => {
    const reg = android()
    const t = { theme: 'dark', density: 'cozy', sidebarWidth: 10, unknownThing: [1, 2] }
    expect(reg.mergeTweaks({}, reg.splitTweaks(t))).toEqual(t)
    const local = { theme: 'light', sidebarWidth: 5, localOnly: true }
    const merged = reg.mergeTweaks(local, { account: { theme: 'dark' }, device: { sidebarWidth: 99 } })
    expect(merged).toEqual({ theme: 'dark', sidebarWidth: 99, localOnly: true })
  })

  it('merge keeps local values for a missing side and ignores fields on the wrong side', () => {
    const reg = desktop()
    const local = { theme: 'light', sidebarWidth: 5 }
    expect(reg.mergeTweaks(local, { account: undefined, device: undefined })).toEqual(local)
    expect(reg.mergeTweaks(local, { account: { sidebarWidth: 1 }, device: { theme: 'x' } })).toEqual(local)
  })

  it('tolerates non-object input', () => {
    const reg = desktop()
    expect(reg.splitTweaks(null)).toEqual({ account: {}, device: {} })
    expect(reg.splitTweaks('x')).toEqual({ account: {}, device: {} })
    expect(reg.mergeTweaks(null, { account: { theme: 'a' }, device: {} })).toEqual({ theme: 'a' })
  })
})

describe('mergers.profiles', () => {
  it('unions by id', () => {
    const reg = desktop()
    expect(reg.mergers.profiles([{ id: 'a' }], [{ id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('keeps local order, lets remote fields win for the same id, ignores bad entries', () => {
    const reg = android()
    const out = reg.mergers.profiles(
      [{ id: 'a', name: 'old', color: 'red' }, { id: 'c' }],
      [{ id: 'a', name: 'new' }, { id: 'b' }, null, { name: 'no id' }],
    )
    expect(out).toEqual([{ id: 'a', name: 'new', color: 'red' }, { id: 'c' }, { id: 'b' }])
  })

  it('duplicate ids inside one list are deterministic: last wins field by field', () => {
    const reg = desktop()
    expect(reg.mergers.profiles(
      [{ id: 'a', name: '1', color: 'red' }, { id: 'a', name: '2' }], [],
    )).toEqual([{ id: 'a', name: '2', color: 'red' }])
    expect(reg.mergers.profiles(
      [], [{ id: 'a', name: '1' }, { id: 'b' }, { id: 'a', name: '3' }],
    )).toEqual([{ id: 'a', name: '3' }, { id: 'b' }])
  })

  it('tolerates non-arrays', () => {
    expect(desktop().mergers.profiles(undefined, [{ id: 'a' }])).toEqual([{ id: 'a' }])
    expect(desktop().mergers.profiles([{ id: 'a' }], 'x')).toEqual([{ id: 'a' }])
  })
})

describe('prototype safety', () => {
  const evil = () => JSON.parse('{"__proto__": {"x": 1}, "constructor": {"y": 2}, "prototype": 3, "theme": "dark", "sidebarWidth": 7}')

  it('splitTweaks ignores __proto__, constructor and prototype', () => {
    const { account, device } = desktop().splitTweaks(evil())
    expect(account).toEqual({ theme: 'dark' })
    expect(device).toEqual({ sidebarWidth: 7 })
    expect(Object.getPrototypeOf(device)).toBe(Object.prototype)
    expect({}.x).toBeUndefined()
    expect(Object.prototype.x).toBeUndefined()
  })

  it('mergeTweaks ignores them on either side and in local', () => {
    const reg = desktop()
    const out = reg.mergeTweaks(evil(), { account: evil(), device: evil() })
    expect(out).toEqual({ theme: 'dark', sidebarWidth: 7 })
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(out.x).toBeUndefined()
    expect({}.x).toBeUndefined()
    expect(Object.prototype.y).toBeUndefined()
  })

  it('profile merger ignores unsafe keys and ids', () => {
    const reg = desktop()
    const entry = JSON.parse('{"id": "a", "__proto__": {"polluted": true}, "name": "n"}')
    const out = reg.mergers.profiles([], [entry, JSON.parse('{"id": "__proto__"}')])
    expect(out).toEqual([{ id: 'a', name: 'n' }])
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype)
    expect(out[0].polluted).toBeUndefined()
    expect({}.polluted).toBeUndefined()
  })
})

describe('secrets', () => {
  it('secretId and isSecretId', () => {
    const reg = desktop()
    const id = reg.secretId('dbManager.secret.c1')
    expect(id).toBe('sec:nexusmd:dbManager.secret.c1')
    expect(reg.isSecretId(id)).toBe(true)
    expect(reg.isSecretId('nexusmd:p.1.google.auth')).toBe(false)
    expect(reg.isSecretId(null)).toBe(false)
  })

  it('secrets are platform-private', () => {
    const d = desktop(), a = android()
    const id = d.secretId('x')
    expect(a.isSecretId(id)).toBe(true)
    expect(d.secretName(id)).toBe('x')
    expect(a.secretName(id)).toBeNull()
    expect(d.toStorageKey(id)).toBe('nexusmd.sec.x')
    expect(a.toStorageKey(id)).toBeNull()
  })

  it('account secrets never sync', () => {
    expect(desktop().secretId('account.keys')).toBeNull()
    expect(desktop().secretId('p.1.account.x')).toBeNull()
    expect(desktop().toStorageKey('sec:nexusmd:account.keys')).toBeNull()
  })
})

describe('public api', () => {
  it('is exported from the core index', () => {
    expect(typeof core.createKeyRegistry).toBe('function')
    expect(core.TWEAK_ACCOUNT_FIELDS).toEqual(TWEAK_ACCOUNT_FIELDS)
    expect(core.KEY_ALIASES).toBe(ALIASES)
    expect(core.SYNC_SKIP).toBe(SYNC_SKIP)
    expect(core.isSkippedKey).toBe(isSkippedKey)
  })
})
