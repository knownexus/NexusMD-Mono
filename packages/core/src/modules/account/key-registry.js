// key-registry.js — decides, for every localStorage key on a device, whether it syncs to the
// account, at which level, and under which canonical item id.
//
//   level 'account'  shared by every device signed in to the account
//   level 'device'   a per-device preference (still synced, but kept in the device container)
//
// Canonical ids (they only ever appear inside encrypted payloads; the sync engine hashes them
// to opaque ids, so readability is fine):
//   profiles / activeProfileId       neutral, identical on every platform
//   tweaks.account / tweaks.device   the two halves of the tweaks object (helm only; see splitTweaks)
//   [p.<pid>.]<alias id>             neutral ids for the ADO / GitHub / Jira connection fields,
//                                    plain keys and (nexusmd) secrets named `nexusmd.p.<pid>.<alias>`
//   <ns>:<rest>                      everything else (tokens included), private to a platform
//   <ns>:<rest>#<recordId>           one record of a collection, or one field of a field map (nexusmd)
//   sec:<ns>:<name>                  any other secure-storage entry, private to a platform
//
// nexusmd (desktop, registry v2) differs from helm (Android, the Milestone 1 rules, unchanged):
//   - user data lives only under `nexusmd.p.<pid>.`; outside it only `profiles`, `activeProfileId`
//     and `feature.*` sync, every other global key is not synced;
//   - only `sidebar.width` stays device level, everything else under a profile is account level;
//   - content keys (COLLECTIONS) are record collections (`kind: 'collection'`), the per-profile
//     tweaks key is a field map (`kind: 'fields'`), and every result says whether the app writes
//     the value on its own (`auto`, see MACHINE_WRITTEN).
//
// Headless: no localStorage access here. The platform passes in the storage keys it has.

const NAMESPACES = ['nexusmd', 'helm']

// Caches and in-flight state: rebuilt on their own, and stale or wrong on another machine.
// Shared with the desktop settings file (apps/desktop/src/settings-file.js), which carries
// secrets decrypted instead of as `<ns>.sec.*` keys. Namespace-aware: covers desktop
// (`nexusmd.`) and Android (`helm.`) keys alike.
export const SYNC_SKIP = [
  /^(?:nexusmd|helm)\.sec\./,
  /^(?:nexusmd|helm)\.oauth\.pending$/,
  /^(?:nexusmd|helm)\.sync\.base\./,
  /\.cache(\.v\d+)?$/,
  /\.wiTypeDefs\./,
  /\.git\.snapshot$/,
  /^(?:nexusmd|helm)\.workitems\.status\.v\d+$/,
]

export const isSkippedKey = (key) => SYNC_SKIP.some(re => re.test(key))

// Content (planner, calendar, lists, time log) that Milestone 1 does not carry. Still never
// synced for helm; nexusmd syncs it, the record collections as one item per record.
const CONTENT_NEVER_SYNC = [
  /\.planner\.week\./,
  /\.planner\.globalNotes/,
  /\.planner\.versions$/,
  /\.calendar\.events(?:\.|$)/,
  /\.lists(?:\.|$)/,
  /\.timelog(?:\.|$)/,
]

// On top of the shared skip list, keys that account sync never carries: the account's own
// state and device-local state.
const NEVER_SYNC = [
  /\.account\./,
  /^(?:nexusmd|helm)\.(?:p\.[^.]+\.)?planner$/,   // Android's legacy whole-planner blob
  // Device-local state: queued unsent mutations (must not replay on another device), large
  // virtual-file blobs, SAF folder URIs that mean nothing elsewhere, and migration markers.
  /^(?:nexusmd|helm)\.(?:p\.[^.]+\.)?offlineQueue$/,
  /\.android\.(?:editorfs|apifs):/,
  /\.android\.editor\.safFolders$/,
  /^(?:nexusmd|helm)\.(?:p\.[^.]+\.)?(?:migrated|planner\.legacyMigrated)$/,
]

// Connection fields that mean the same thing on both platforms but are stored under different
// names. Verified against core's makeAdoConfig / makeGithubConfig / makeJiraConfig (which both
// platforms use) and the key builders in modules/work/src/renderer/{ado,github,jira}-client.js
// (desktop: getProfileKey('ado.' | 'github.' | 'jira.' + name)) and apps/app/src/{ado,github,jira}-client.js
// (Android: getProfileKey('helm.android.' | 'helm.android.github.' | 'helm.android.jira.' + name)).
// `nexusmd` and `helm` are the key names after the `<ns>.` or `<ns>.p.<pid>.` prefix.
const ADO_FIELDS = ['org', 'pat', 'projects', 'testProject', 'uatProject', 'uatPipelineId', 'uatBranch', 'refreshSecs', 'workItems']
const GITHUB_FIELDS = ['pat', 'repos', 'issues', 'inWork', 'login', 'refreshSecs']
const JIRA_FIELDS = ['site', 'email', 'apiToken', 'projectKeys', 'jql', 'boardId', 'enabled', 'refreshSecs']

export const ALIASES = Object.freeze([
  ...ADO_FIELDS.map(n => ({ id: `ado.${n}`, nexusmd: `ado.${n}`, helm: `android.${n}` })),
  ...GITHUB_FIELDS.map(n => ({ id: `github.${n}`, nexusmd: `github.${n}`, helm: `android.github.${n}` })),
  ...JIRA_FIELDS.map(n => ({ id: `jira.${n}`, nexusmd: `jira.${n}`, helm: `android.jira.${n}` })),
].map(Object.freeze))

// Everything in tweaks that follows the person; every other field (known device ones and any
// the future adds) stays on the device.
export const TWEAK_ACCOUNT_FIELDS = Object.freeze([
  'theme', 'lightTheme', 'dimTheme', 'darkTheme', 'density', 'typeLabels', 'quickLinks', 'showMarkdown',
])

// Per-device preferences, matched against the key name without its `<ns>.` / `p.<pid>.` prefix.
// The Milestone 1 list: still the rule for helm, and what wasDeviceLevelInM1 recognises.
const M1_DEVICE_LEVEL = [
  /^sidebar\.width$/,
  /^fields\./,
  /^builds\.(?:collapsed|sortDir|hiddenCols|colOrder|statuses)$/,
  /^wi\./,
  /^notif\./,
  /^refreshInterval$/,
  /^markdown\.textSize$/,
]

// nexusmd: the only per-device preference left (the window layout of this machine). The app
// writes it both globally and per profile; both forms sync, at device level.
const DEVICE_LEVEL = [/^sidebar\.width$/]

// nexusmd: connection fields that are credentials. They sync only as secrets (neutral id
// `p.<pid>.<alias id>`, secure-storage name `nexusmd.p.<pid>.<alias name>`); a plaintext key
// holding one is never synced (the token migration moves it into secure storage).
const TOKEN_ALIAS_IDS = new Set(['ado.pat', 'github.pat', 'jira.apiToken'])

// nexusmd content keys that hold many records, matched against the name after `p.<pid>.`.
// `path` is where the record array sits in the stored JSON: null for an array at the root,
// otherwise the property of the root object that holds it. Each record syncs as its own item,
// `<base id>#<record id>`.
export const COLLECTIONS = Object.freeze([
  { name: /^planner\.globalNotes$/, path: null },
  { name: /^planner\.versions$/, path: null },
  { name: /^calendar\.events$/, path: null },
  { name: /^lists$/, path: 'lists' },
  { name: /^timelog\.v1$/, path: 'entries' },
  { name: /^md_documents$/, path: 'docs' },
  { name: /^json_editor_documents$/, path: null },
  { name: /^regex_tester_documents$/, path: null },
  { name: /^dbManager\.savedQueries$/, path: null },
].map(Object.freeze))

// nexusmd values the app writes on its own (token refreshes, seen flags, collapsed state,
// last-used markers, open-connection lists), matched against the name after `p.<pid>.`. They
// resolve newest-wins and never raise a conflict.
export const MACHINE_WRITTEN = Object.freeze([
  /\.auth$/,
  /^seenPr$/,
  /collapsed/i,
  /^dbManager\.(openConnections|listHidden|lastType)$/,
  /^apiClient\.collapsedDirs$/,
  /^planner\.(reminderDismissed|landing)$/,
  /^editor\.recent$/,
])

const isMachineWritten = (name) => MACHINE_WRITTEN.some(re => re.test(name))

const TWEAKS_ACCOUNT_ID = 'tweaks.account'
const TWEAKS_DEVICE_ID = 'tweaks.device'

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// Remote JSON can carry own '__proto__' / 'constructor' / 'prototype' properties; assigning them
// with a plain `obj[k] = v` could reach Object.prototype. They are never kept.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ownSafeEntries = (obj) => (isPlainObject(obj)
  ? Object.keys(obj).filter(k => !UNSAFE_KEYS.has(k)).map(k => [k, obj[k]])
  : [])

export function createKeyRegistry({ namespace, getActiveProfileId } = {}) {
  if (!NAMESPACES.includes(namespace)) {
    throw new Error(`createKeyRegistry requires namespace 'nexusmd' or 'helm' (got ${JSON.stringify(namespace)})`)
  }
  const prefix = `${namespace}.`
  const secPrefix = `${namespace}.sec.`
  const otherAliasField = namespace // 'nexusmd' | 'helm': the ALIASES column for this platform
  const byName = new Map(ALIASES.map(r => [r[otherAliasField], r]))
  const byId = new Map(ALIASES.map(r => [r.id, r]))
  const v2 = namespace === 'nexusmd'
  const neverSync = v2 ? NEVER_SYNC : [...NEVER_SYNC, ...CONTENT_NEVER_SYNC]

  const activeProfile = () => {
    try { return (getActiveProfileId && getActiveProfileId()) || '' } catch { return '' }
  }

  // '<ns>.p.<pid>.<name>' -> { pid, name }; '<ns>.<name>' -> { pid: null, name }.
  const parse = (key) => {
    const rest = key.slice(prefix.length)
    const m = /^p\.([^.]+)\.(.+)$/.exec(rest)
    return m ? { pid: m[1], name: m[2], rest } : { pid: null, name: rest, rest }
  }

  const tweaksKey = () => {
    // Android keeps tweaks per profile (getProfileKey('helm.tweaks')); desktop keeps one global key.
    const pid = namespace === 'helm' ? activeProfile() : ''
    return pid ? `${prefix}p.${pid}.tweaks` : `${prefix}tweaks`
  }

  const isAccountSecretName = (name) => /(?:^|\.)account\./.test(name)

  // nexusmd (registry v2). `#` separates a record id from its base id, so no key holding one
  // is synced: its id would read as a record of another item.
  function classifyV2({ pid, name, rest }) {
    if (rest.includes('#')) return null
    if (!pid) {
      if (name === 'profiles') return { id: 'profiles', level: 'account', auto: false }
      if (name === 'activeProfileId') return { id: 'activeProfileId', level: 'device', auto: false }
      if (/^feature\./.test(name) || DEVICE_LEVEL.some(re => re.test(name))) {
        return { id: `${namespace}:${rest}`, level: 'device', auto: false }
      }
      return null // global user data is not synced; it belongs under a profile
    }
    const auto = isMachineWritten(name)
    const id = `${namespace}:${rest}`
    if (name === 'tweaks') return { id, level: 'account', kind: 'fields', auto }
    const coll = COLLECTIONS.find(c => c.name.test(name))
    if (coll) return { id, level: 'account', kind: 'collection', collection: { path: coll.path }, auto }
    const level = DEVICE_LEVEL.some(re => re.test(name)) ? 'device' : 'account'
    const alias = byName.get(name)
    if (alias && TOKEN_ALIAS_IDS.has(alias.id)) return null // a token syncs only as a secret
    return { id: alias ? `p.${pid}.${alias.id}` : id, level, auto }
  }

  function classify(storageKey) {
    if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return null
    if (isSkippedKey(storageKey) || neverSync.some(re => re.test(storageKey))) return null
    const parsed = parse(storageKey)
    const { pid, name, rest } = parsed
    if (!name) return null
    if (v2) return classifyV2(parsed)

    if (!pid && name === 'profiles') return { id: 'profiles', level: 'account' }
    if (!pid && name === 'activeProfileId') return { id: 'activeProfileId', level: 'device' }

    if (name === 'tweaks') {
      // Several tweaks keys (global, per profile) would collide on one id. When the platform
      // supplies getActiveProfileId, exactly one key is the tweaks key (see tweaksKey) and any
      // other shape is ignored. Without it every shape is accepted, which is only safe when the
      // device holds a single tweaks key.
      if (getActiveProfileId && storageKey !== tweaksKey()) return null
      return { id: TWEAKS_ACCOUNT_ID, level: 'account', split: true, accountId: TWEAKS_ACCOUNT_ID, deviceId: TWEAKS_DEVICE_ID }
    }

    const level = M1_DEVICE_LEVEL.some(re => re.test(name)) ? 'device' : 'account'
    const alias = byName.get(name)
    if (alias) return { id: pid ? `p.${pid}.${alias.id}` : alias.id, level }
    return { id: `${namespace}:${rest}`, level }
  }

  function toStorageKey(id) {
    if (typeof id !== 'string' || !id) return null
    let key = null

    const token = tokenSecretName(id)
    if (token) return `${secPrefix}${token}`

    const secret = /^sec:(nexusmd|helm):(.+)$/.exec(id)
    if (secret) {
      if (secret[1] !== namespace || isAccountSecretName(secret[2])) return null
      return `${secPrefix}${secret[2]}`
    }

    const own = /^(nexusmd|helm):(.+)$/.exec(id)
    if (own) {
      if (own[1] !== namespace) return null
      key = `${prefix}${own[2]}`
    } else if (id === TWEAKS_ACCOUNT_ID || id === TWEAKS_DEVICE_ID) {
      // Both halves live in the one tweaks key, which classify names by the account id.
      key = tweaksKey()
      return classify(key)?.accountId === TWEAKS_ACCOUNT_ID ? key : null
    } else if (id === 'profiles' || id === 'activeProfileId') {
      key = `${prefix}${id}`
    } else {
      const m = /^(?:p\.([^.]+)\.)?(.+)$/.exec(id)
      const alias = m && byId.get(m[2])
      if (!alias) return null
      key = `${prefix}${m[1] ? `p.${m[1]}.` : ''}${alias[namespace]}`
    }

    // Accept only the canonical id classify gives this key, so a remote id can neither name a
    // key that is not synced nor reach a key through a second spelling (e.g. 'nexusmd:tweaks').
    return classify(key)?.id === id ? key : null
  }

  function splitTweaks(obj) {
    const account = {}
    const device = {}
    if (!isPlainObject(obj)) return { account, device }
    for (const [k, v] of ownSafeEntries(obj)) {
      if (TWEAK_ACCOUNT_FIELDS.includes(k)) account[k] = v
      else device[k] = v
    }
    return { account, device }
  }

  function mergeTweaks(local, { account, device } = {}) {
    const out = {}
    for (const [k, v] of ownSafeEntries(local)) out[k] = v
    for (const [k, v] of ownSafeEntries(account)) if (TWEAK_ACCOUNT_FIELDS.includes(k)) out[k] = v
    for (const [k, v] of ownSafeEntries(device)) if (!TWEAK_ACCOUNT_FIELDS.includes(k)) out[k] = v
    return out
  }

  // Union by id, local entries first (in their order), then remote-only ones. For the same id the
  // entries are combined field by field and the later one wins: remote over local, and the last
  // of two duplicates inside one list. That is the Milestone 1 rule; it does not claim the remote
  // is newer. Nothing is ever deleted.
  const mergeProfiles = (local, remote) => {
    const out = []
    const index = new Map()
    const take = (list) => {
      if (!Array.isArray(list)) return
      for (const p of list) {
        if (!isPlainObject(p) || typeof p.id !== 'string' || !p.id || UNSAFE_KEYS.has(p.id)) continue
        const fields = Object.fromEntries(ownSafeEntries(p))
        if (index.has(p.id)) {
          out[index.get(p.id)] = { ...out[index.get(p.id)], ...fields }
        } else {
          index.set(p.id, out.length)
          out.push(fields)
        }
      }
    }
    take(local)
    take(remote)
    return out
  }

  // Secure-storage entries, found by the platform as localStorage keys starting with secPrefix.
  // Account secrets are never synced (secretId returns null for them).
  // nexusmd: a token (TOKEN_ALIAS_IDS) kept as a secret (`nexusmd.p.<pid>.<alias name>`) gets the
  // neutral alias id `p.<pid>.<alias id>`, shared with Android, and that id is always a secret
  // id on this platform. Every other secret keeps the platform-private `sec:<ns>:<name>`.
  const neutralSecretId = (name) => {
    const m = /^nexusmd\.p\.([^.#]+)\.(.+)$/.exec(name)
    const alias = m && byName.get(m[2])
    return alias && TOKEN_ALIAS_IDS.has(alias.id) ? `p.${m[1]}.${alias.id}` : null
  }
  // The secure-storage name for a neutral token id, null for any other id (and on helm).
  function tokenSecretName(id) {
    if (!v2 || typeof id !== 'string') return null
    const n = /^p\.([^.#]+)\.(.+)$/.exec(id)
    const alias = n && TOKEN_ALIAS_IDS.has(n[2]) && byId.get(n[2])
    return alias ? `nexusmd.p.${n[1]}.${alias.nexusmd}` : null
  }
  const secretId = (name) => {
    if (typeof name !== 'string' || !name || isAccountSecretName(name)) return null
    if (v2 && name.includes('#')) return null // `#` separates record ids
    return (v2 && neutralSecretId(name)) || `sec:${namespace}:${name}`
  }
  const isSecretId = (id) => typeof id === 'string' && (id.startsWith('sec:') || !!tokenSecretName(id))
  // A plaintext storage key holding a token (nexusmd). Never synced; account switch removes it.
  const isPlainTokenKey = (key) => {
    if (!v2 || typeof key !== 'string' || !key.startsWith(prefix)) return false
    const { pid, name } = parse(key)
    const alias = pid && byName.get(name)
    return !!alias && TOKEN_ALIAS_IDS.has(alias.id)
  }
  // The secure-storage name for a secret id of this platform, null for the other platform's.
  const secretName = (id) => {
    if (typeof id !== 'string') return null
    const token = tokenSecretName(id)
    if (token) return token
    const m = /^sec:(nexusmd|helm):(.+)$/.exec(id)
    return m && m[1] === namespace && !isAccountSecretName(m[2]) ? m[2] : null
  }

  // The profile an item belongs to: `p.<pid>.` at the start of the canonical id, after `<ns>:`,
  // or at the start of a secret's name (`sec:<ns>:` then the name, itself maybe `<ns>.p.<pid>.`).
  const profileOf = (id) => {
    if (typeof id !== 'string') return null
    const s = id.replace(/^sec:(?:nexusmd|helm):/, '').replace(/^(?:nexusmd|helm)[:.]/, '')
    const m = /^p\.([^.#]+)\./.exec(s)
    return m ? m[1] : null
  }

  // True for ids whose value Milestone 1 kept in the device container: the active profile, the
  // device half of tweaks, keys matching the M1 device-level names, and (as field-map items)
  // every tweaks field that is not an M1 account field.
  const ownIdRe = new RegExp(`^${namespace}:(?:p\\.[^.#]+\\.)?(.+)$`)
  const wasDeviceLevelInM1 = (id) => {
    if (id === 'activeProfileId' || id === TWEAKS_DEVICE_ID) return true
    const m = typeof id === 'string' ? ownIdRe.exec(id) : null
    if (!m) return false
    const field = /^tweaks#(.+)$/.exec(m[1])
    if (field) return !TWEAK_ACCOUNT_FIELDS.includes(field[1])
    return !m[1].includes('#') && M1_DEVICE_LEVEL.some(re => re.test(m[1]))
  }

  return {
    namespace,
    secPrefix,
    classify,
    toStorageKey,
    splitTweaks,
    mergeTweaks,
    mergers: { profiles: mergeProfiles },
    secretId,
    isSecretId,
    secretName,
    isPlainTokenKey,
    profileOf,
    wasDeviceLevelInM1,
  }
}
