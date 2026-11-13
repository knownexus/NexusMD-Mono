import { describe, it, expect } from 'vitest'
import {
  createKeyRegistry, TWEAK_ACCOUNT_FIELDS, ALIASES, SYNC_SKIP, isSkippedKey, COLLECTIONS, MACHINE_WRITTEN,
} from '../src/modules/account/key-registry.js'
import { resolveTarget } from '../src/modules/account/account-sync-state.js'
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
    // registry v2: desktop content syncs only under a profile (see 'registry v2' below)
    'nexusmd.planner.week.2026-W40',
    'nexusmd.planner.globalNotes',
    'nexusmd.planner.versions',
    'nexusmd.account.meta',
    'nexusmd.account.deviceId',
    'nexusmd.p.1.account.x',
    'nexusmd.sec.account.keys',
    'nexusmd.lists',
    'nexusmd.timelog.v1',
    'nexusmd.oauth.pending',
    'nexusmd.ado.cache.v1',
    'nexusmd.workitems.status.v2',
    // the profile-scoped caches (Task 8) are just as local
    'nexusmd.p.1.ado.cache.v1',
    'nexusmd.p.1.workitems.status.v1',
    'nexusmd.migrated.v2',
    'nexusmd.migrated.v2.backup.md_documents',
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
    const auto = ns === 'nexusmd' ? { auto: false } : {} // registry v2 marks every desktop result
    expect(reg.classify(`${ns}.profiles`)).toEqual({ id: 'profiles', level: 'account', ...auto })
    expect(reg.classify(`${ns}.activeProfileId`)).toEqual({ id: 'activeProfileId', level: 'device', ...auto })
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
    expect(d).toEqual({ id: 'p.1.ado.org', level: 'account', auto: false })
    expect(a).toEqual({ id: d.id, level: d.level })
    expect(desktop().toStorageKey(d.id)).toBe('nexusmd.p.1.ado.org')
    expect(android().toStorageKey(d.id)).toBe('helm.p.1.android.org')
  })

  it('github and jira fields use each platform key scheme', () => {
    expect(desktop().classify('nexusmd.p.9.github.login').id).toBe(android().classify('helm.p.9.android.github.login').id)
    expect(desktop().classify('nexusmd.p.9.jira.site').id).toBe(android().classify('helm.p.9.android.jira.site').id)
    // registry v2: desktop tokens sync as secrets, under the same neutral id as Android's plain key
    expect(desktop().secretId('nexusmd.p.9.github.pat')).toBe(android().classify('helm.p.9.android.github.pat').id)
    expect(desktop().secretId('nexusmd.p.9.jira.apiToken')).toBe(android().classify('helm.p.9.android.jira.apiToken').id)
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
      expect(a).toEqual({ id: `${scope}${row.id}`, level: 'account' })
      expect(android().toStorageKey(a.id)).toBe(aKey)
      if (!scope) {
        // registry v2: desktop keeps connection fields only under a profile
        expect(d).toBeNull()
        expect(desktop().toStorageKey(a.id)).toBeNull()
        return
      }
      if (['ado.pat', 'github.pat', 'jira.apiToken'].includes(row.id)) {
        // registry v2: a desktop token syncs only as a secret, never as a plaintext key
        expect(d).toBeNull()
        expect(desktop().secretId(dKey)).toBe(a.id)
        expect(desktop().toStorageKey(a.id)).toBe(`nexusmd.sec.${dKey}`)
        return
      }
      expect(d).toEqual({ id: a.id, level: 'account', auto: false })
      expect(desktop().toStorageKey(d.id)).toBe(dKey)
    })
  })
})

describe('platform-private keys', () => {
  it('google tokens keep their namespace and never cross platforms', () => {
    const d = desktop().classify('nexusmd.p.1.google.auth')
    const a = android().classify('helm.p.1.google.auth')
    expect(d).toEqual({ id: 'nexusmd:p.1.google.auth', level: 'account', auto: true })
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
    expect(c).toEqual({ id: 'nexusmd:p.1.team.custom', level: 'account', auto: false })
    expect(desktop().toStorageKey(c.id)).toBe('nexusmd.p.1.team.custom')
    expect(android().classify('helm.theme')).toEqual({ id: 'helm:theme', level: 'account' })
    // registry v2: a global desktop key is not synced
    expect(desktop().classify('nexusmd.theme')).toBeNull()
    expect(desktop().toStorageKey('nexusmd:theme')).toBeNull()
  })

  it('toStorageKey accepts only the canonical id classify produces', () => {
    const d = desktop(), a = android()
    // non-canonical spellings of keys that classify to another id
    expect(d.toStorageKey('nexusmd:tweaks')).toBeNull()
    expect(a.toStorageKey('helm:p.1.tweaks')).toBeNull()
    // registry v2: the per-profile desktop tweaks key is canonical (a field map)
    expect(d.toStorageKey('nexusmd:p.1.tweaks')).toBe('nexusmd.p.1.tweaks')
    expect(d.toStorageKey('nexusmd:p.1.lists#l1')).toBeNull()
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
      ['nexusmd', 'nexusmd.p.1.google.auth'], ['nexusmd', 'nexusmd.p.1.sidebar.width'], ['nexusmd', 'nexusmd.p.1.tweaks'],
      ['nexusmd', 'nexusmd.p.1.lists'], ['nexusmd', 'nexusmd.feature.x'], ['helm', 'helm.p.1.android.jira.site'],
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
  it.each(deviceKeys)('%s is device level on Android; on desktop only sidebar.width stays device level', (name) => {
    expect(android().classify(`helm.p.7.${name}`)).toEqual({ id: `helm:p.7.${name}`, level: 'device' })
    // registry v2: desktop syncs it only under a profile, and only sidebar.width is still per
    // device (it alone also syncs in its global form)
    if (name === 'sidebar.width') expect(desktop().classify(`nexusmd.${name}`).level).toBe('device')
    else expect(desktop().classify(`nexusmd.${name}`)).toBeNull()
    const d = desktop().classify(`nexusmd.p.7.${name}`)
    expect(d.id).toBe(`nexusmd:p.7.${name}`)
    expect(d.level).toBe(name === 'sidebar.width' ? 'device' : 'account')
  })

  it('other builds and wi neighbours default to account level', () => {
    expect(android().classify('helm.builds.acknowledged').level).toBe('account')
    expect(desktop().classify('nexusmd.p.1.builds.acknowledged').level).toBe('account')
    expect(desktop().classify('nexusmd.p.1.builds.hiddenPipelines').level).toBe('account')
    expect(desktop().classify('nexusmd.p.1.ui.drawerWidth').level).toBe('account')
  })
})

describe('tweaks', () => {
  it('has the exact account field list', () => {
    expect(TWEAK_ACCOUNT_FIELDS).toEqual([
      'theme', 'lightTheme', 'dimTheme', 'darkTheme', 'density', 'typeLabels', 'quickLinks', 'showMarkdown',
      'homeWidgets',
    ])
  })

  it('classifies Android tweaks as a split; desktop tweaks are a per-profile field map (registry v2)', () => {
    const want = { id: 'tweaks.account', level: 'account', split: true, accountId: 'tweaks.account', deviceId: 'tweaks.device' }
    expect(android().classify('helm.tweaks')).toEqual(want)
    expect(android().classify('helm.p.1.tweaks')).toEqual(want)
    expect(desktop().classify('nexusmd.tweaks')).toBeNull()
    expect(desktop().classify('nexusmd.p.1.tweaks')).toEqual({ id: 'nexusmd:p.1.tweaks', level: 'account', kind: 'fields', auto: false })
  })

  it('toStorageKey for both tweak ids is the namespace tweaks key (Android only)', () => {
    expect(android().toStorageKey('tweaks.account')).toBe('helm.tweaks')
    expect(android().toStorageKey('tweaks.device')).toBe('helm.tweaks')
    expect(desktop().toStorageKey('tweaks.account')).toBeNull()
    expect(desktop().toStorageKey('tweaks.device')).toBeNull()
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

  it('desktop accepts every profile tweaks key, whatever the active profile (registry v2)', () => {
    const reg = createKeyRegistry({ namespace: 'nexusmd', getActiveProfileId: () => 'abc' })
    expect(reg.classify('nexusmd.tweaks')).toBeNull()
    expect(reg.classify('nexusmd.p.abc.tweaks').id).toBe('nexusmd:p.abc.tweaks')
    expect(reg.classify('nexusmd.p.zzz.tweaks').id).toBe('nexusmd:p.zzz.tweaks')
  })

  it('desktop has no split tweak ids even with an active profile (registry v2)', () => {
    const reg = createKeyRegistry({ namespace: 'nexusmd', getActiveProfileId: () => 'abc' })
    expect(reg.toStorageKey('tweaks.account')).toBeNull()
  })

  it('splitTweaks puts account fields in account and everything else, unknown included, in device', () => {
    const reg = desktop()
    const t = {
      theme: 'dark', density: 'compact', quickLinks: ['a'], showMarkdown: true, homeWidgets: [],
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

describe('registry v2 (nexusmd): profile scope, collections, field maps, machine-written', () => {
  it('collection keys are record collections with the path of their record array', () => {
    expect(desktop().classify('nexusmd.p.A.planner.globalNotes')).toEqual({
      id: 'nexusmd:p.A.planner.globalNotes', kind: 'collection', collection: { path: null }, level: 'account', auto: false,
    })
    expect(desktop().classify('nexusmd.p.A.lists').collection.path).toBe('lists')
    expect(desktop().classify('nexusmd.p.A.timelog.v1').collection.path).toBe('entries')
  })

  it('COLLECTIONS has the exact name -> path table', () => {
    const want = {
      'planner.globalNotes': null, 'planner.versions': null, 'calendar.events': null, lists: 'lists',
      'timelog.v1': 'entries', md_documents: 'docs', json_editor_documents: null,
      regex_tester_documents: null, 'dbManager.savedQueries': null,
    }
    expect(COLLECTIONS).toHaveLength(Object.keys(want).length)
    for (const [name, path] of Object.entries(want)) {
      const c = desktop().classify(`nexusmd.p.A.${name}`)
      expect(c.kind).toBe('collection')
      expect(c.collection).toEqual({ path })
      expect(c.level).toBe('account')
    }
    expect(COLLECTIONS.every(c => c.name instanceof RegExp)).toBe(true)
  })

  it('formerly never-synced content now syncs under a profile', () => {
    expect(desktop().classify('nexusmd.p.A.planner.week.2026-W40')).toEqual({
      id: 'nexusmd:p.A.planner.week.2026-W40', level: 'account', auto: false,
    })
    expect(desktop().classify('nexusmd.p.A.calendar.events').kind).toBe('collection')
    expect(desktop().classify('nexusmd.p.A.planner.versions').kind).toBe('collection')
  })

  it('the per-profile tweaks key is a field map', () => {
    expect(desktop().classify('nexusmd.p.A.tweaks')).toEqual({
      id: 'nexusmd:p.A.tweaks', level: 'account', kind: 'fields', auto: false,
    })
    const reg = createKeyRegistry({ namespace: 'nexusmd', getActiveProfileId: () => 'A' })
    expect(reg.classify('nexusmd.p.B.tweaks').kind).toBe('fields')
    expect(reg.toStorageKey('nexusmd:p.B.tweaks')).toBe('nexusmd.p.B.tweaks')
  })

  it('global keys outside a profile do not sync, except profiles, activeProfileId and feature.*', () => {
    const d = desktop()
    expect(d.classify('nexusmd.tweaks')).toBeNull()
    expect(d.classify('nexusmd.refreshInterval')).toBeNull()
    expect(d.classify('nexusmd.theme')).toBeNull()
    expect(d.classify('nexusmd.ado.org')).toBeNull()
    expect(d.classify('nx-db:saved-queries')).toBeNull()
    expect(d.toStorageKey('tweaks.account')).toBeNull()
    expect(d.toStorageKey('tweaks.device')).toBeNull()
    expect(d.toStorageKey('ado.org')).toBeNull()
    expect(d.classify('nexusmd.profiles')).toEqual({ id: 'profiles', level: 'account', auto: false })
    expect(d.classify('nexusmd.activeProfileId')).toEqual({ id: 'activeProfileId', level: 'device', auto: false })
    expect(d.classify('nexusmd.feature.legacyCloudSync')).toEqual({ id: 'nexusmd:feature.legacyCloudSync', level: 'device', auto: false })
    expect(d.toStorageKey('nexusmd:feature.legacyCloudSync')).toBe('nexusmd.feature.legacyCloudSync')
  })

  it('only sidebar.width stays device level; the rest of M1 device keys follow the profile', () => {
    const d = desktop()
    expect(d.classify('nexusmd.p.A.refreshInterval').level).toBe('account')
    expect(d.classify('nexusmd.p.A.sidebar.width').level).toBe('device')
    for (const name of ['fields.wiCard', 'builds.sortDir', 'wi.view', 'notif.digest', 'markdown.textSize']) {
      expect(d.classify(`nexusmd.p.A.${name}`).level).toBe('account')
    }
  })

  it('machine-written values are marked auto', () => {
    const d = desktop()
    expect(d.classify('nexusmd.p.A.github.auth').auto).toBe(true)
    expect(d.classify('nexusmd.p.A.github.repos').auto).toBe(false)
    for (const name of ['google.auth', 'seenPr', 'builds.collapsed', 'wi.collapsed.board', 'dbManager.openConnections',
      'dbManager.listHidden', 'dbManager.lastType', 'apiClient.collapsedDirs', 'planner.reminderDismissed',
      'planner.landing', 'editor.recent']) {
      expect(d.classify(`nexusmd.p.A.${name}`).auto).toBe(true)
    }
    for (const name of ['team.custom', 'editor.recentFoo', 'planner.week.2026-W40', 'dbManager.savedQueries']) {
      expect(d.classify(`nexusmd.p.A.${name}`).auto).toBe(false)
    }
    expect(MACHINE_WRITTEN.every(re => re instanceof RegExp)).toBe(true)
  })

  it('connection-field secrets get neutral ids', () => {
    const d = desktop()
    expect(d.secretId('nexusmd.p.A.ado.pat')).toBe('p.A.ado.pat')
    expect(d.secretName('p.A.ado.pat')).toBe('nexusmd.p.A.ado.pat')
    expect(d.secretId('nexusmd.p.A.jira.apiToken')).toBe('p.A.jira.apiToken')
    expect(d.secretName(d.secretId('nexusmd.p.A.github.pat'))).toBe('nexusmd.p.A.github.pat')
    // other secrets keep their platform-private id
    expect(d.secretId('nexusmd.p.A.github.auth')).toBe('sec:nexusmd:nexusmd.p.A.github.auth')
    expect(d.secretName('sec:nexusmd:nexusmd.p.A.github.auth')).toBe('nexusmd.p.A.github.auth')
    expect(d.secretName('p.A.ado.nothing')).toBeNull()
    expect(d.secretName('ado.pat')).toBeNull()
    expect(android().secretName('p.A.ado.pat')).toBeNull()
  })

  it('profileOf names the profile an item belongs to', () => {
    const d = desktop()
    expect(d.profileOf('nexusmd:p.A.lists#l1')).toBe('A')
    expect(d.profileOf('p.A.ado.pat')).toBe('A')
    expect(d.profileOf('sec:nexusmd:nexusmd.p.A.github.auth')).toBe('A')
    expect(d.profileOf('sec:nexusmd:p.B.x')).toBe('B')
    expect(d.profileOf('nexusmd:p.A.tweaks#theme')).toBe('A')
    expect(d.profileOf('profiles')).toBeNull()
    expect(d.profileOf('nexusmd:feature.x')).toBeNull()
    expect(d.profileOf(null)).toBeNull()
  })

  it('wasDeviceLevelInM1 covers the old device names and the device tweaks fields', () => {
    const d = desktop()
    for (const name of ['sidebar.width', 'fields.wiCard', 'builds.collapsed', 'builds.statuses', 'wi.view',
      'notif.digest', 'refreshInterval', 'markdown.textSize']) {
      expect(d.wasDeviceLevelInM1(`nexusmd:p.A.${name}`)).toBe(true)
    }
    expect(d.wasDeviceLevelInM1('nexusmd:p.A.tweaks#sidebarWidth')).toBe(true)
    expect(d.wasDeviceLevelInM1('nexusmd:p.A.tweaks#someFutureField')).toBe(true)
    expect(d.wasDeviceLevelInM1('activeProfileId')).toBe(true)
    for (const f of TWEAK_ACCOUNT_FIELDS) expect(d.wasDeviceLevelInM1(`nexusmd:p.A.tweaks#${f}`)).toBe(false)
    expect(d.wasDeviceLevelInM1('nexusmd:p.A.builds.acknowledged')).toBe(false)
    expect(d.wasDeviceLevelInM1('nexusmd:p.A.team.custom')).toBe(false)
    expect(d.wasDeviceLevelInM1('p.A.ado.org')).toBe(false)
    expect(d.wasDeviceLevelInM1('nexusmd:p.A.lists#l1')).toBe(false)
  })

  it('the global sidebar.width stays device level and synced (spec call 6)', () => {
    const d = desktop()
    expect(d.classify('nexusmd.sidebar.width')).toEqual({ id: 'nexusmd:sidebar.width', level: 'device', auto: false })
    expect(d.toStorageKey('nexusmd:sidebar.width')).toBe('nexusmd.sidebar.width')
  })

  it('tokens (ado.pat, github.pat, jira.apiToken) sync only as secrets, never as plain keys', () => {
    const d = desktop()
    for (const name of ['ado.pat', 'github.pat', 'jira.apiToken']) {
      expect(d.classify(`nexusmd.p.A.${name}`)).toBeNull()
      expect(d.isSecretId(`p.A.${name}`)).toBe(true)
      expect(d.secretName(`p.A.${name}`)).toBe(`nexusmd.p.A.${name}`)
      expect(d.secretId(`nexusmd.p.A.${name}`)).toBe(`p.A.${name}`)
      expect(d.toStorageKey(`p.A.${name}`)).toBe(`nexusmd.sec.nexusmd.p.A.${name}`)
      expect(d.isPlainTokenKey(`nexusmd.p.A.${name}`)).toBe(true)
    }
    // other connection fields stay plain, and a secret named like one is platform-private
    expect(d.isSecretId('p.A.ado.org')).toBe(false)
    expect(d.isPlainTokenKey('nexusmd.p.A.ado.org')).toBe(false)
    expect(d.secretId('nexusmd.p.A.ado.org')).toBe('sec:nexusmd:nexusmd.p.A.ado.org')
    expect(d.secretName('p.A.ado.org')).toBeNull()
    expect(d.isSecretId('ado.pat')).toBe(false)
  })

  it('a neutral token id resolves to a secret target, never a plain key', () => {
    const d = desktop()
    expect(resolveTarget(d, 'p.A.ado.pat')).toEqual({ kind: 'secret', name: 'nexusmd.p.A.ado.pat', level: 'account', auto: false })
    expect(resolveTarget(d, 'p.A.jira.apiToken')).toEqual({ kind: 'secret', name: 'nexusmd.p.A.jira.apiToken', level: 'account', auto: false })
    expect(resolveTarget(d, 'p.A.ado.org')).toEqual({ kind: 'plain', key: 'nexusmd.p.A.ado.org', level: 'account', auto: false })
    // Android keeps its M1 rules: the same id is a plain key there
    expect(resolveTarget(android(), 'p.A.ado.pat')).toEqual({ kind: 'plain', key: 'helm.p.A.android.pat', level: 'account', auto: false })
  })

  it('secretId refuses a name holding the record separator', () => {
    expect(desktop().secretId('nexusmd.p.A.x#y')).toBeNull()
    expect(desktop().secretId('a#b')).toBeNull()
  })

  it('helm keeps the M1 rules (no auto, no collections, old device list)', () => {
    const a = android()
    expect(a.classify('helm.p.1.lists')).toBeNull()
    expect(a.classify('helm.theme')).toEqual({ id: 'helm:theme', level: 'account' })
    expect(a.classify('helm.p.1.refreshInterval')).toEqual({ id: 'helm:p.1.refreshInterval', level: 'device' })
    expect(a.classify('helm.p.1.google.auth')).toEqual({ id: 'helm:p.1.google.auth', level: 'account' })
    expect(a.secretId('helm.p.1.android.pat')).toBe('sec:helm:helm.p.1.android.pat')
  })
})
