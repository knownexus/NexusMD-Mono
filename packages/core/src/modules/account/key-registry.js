// key-registry.js — decides, for every localStorage key on a device, whether it syncs to the
// account, at which level, and under which canonical item id.
//
//   level 'account'  shared by every device signed in to the account
//   level 'device'   a per-device preference (still synced, but kept in the device container)
//
// Canonical ids (they only ever appear inside encrypted payloads; the sync engine hashes them
// to opaque ids, so readability is fine):
//   profiles / activeProfileId       neutral, identical on every platform
//   tweaks.account / tweaks.device   the two halves of the tweaks object (see splitTweaks)
//   [p.<pid>.]<alias id>             neutral ids for the ADO / GitHub / Jira connection fields
//   <ns>:<rest>                      everything else (tokens included), private to a platform
//   sec:<ns>:<name>                  a secure-storage entry, private to a platform
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

// On top of the shared skip list, keys that account sync never carries: the account's own
// state, and the data (planner, calendar, lists, time log) that a later milestone syncs.
const NEVER_SYNC = [
  /\.account\./,
  /\.planner\.week\./,
  /\.planner\.globalNotes/,
  /\.planner\.versions$/,
  /^(?:nexusmd|helm)\.(?:p\.[^.]+\.)?planner$/,   // Android's legacy whole-planner blob
  /\.calendar\.events(?:\.|$)/,
  /\.lists(?:\.|$)/,
  /\.timelog(?:\.|$)/,
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
const DEVICE_LEVEL = [
  /^sidebar\.width$/,
  /^fields\./,
  /^builds\.(?:collapsed|sortDir|hiddenCols|colOrder|statuses)$/,
  /^wi\./,
  /^notif\./,
  /^refreshInterval$/,
  /^markdown\.textSize$/,
]

const TWEAKS_ACCOUNT_ID = 'tweaks.account'
const TWEAKS_DEVICE_ID = 'tweaks.device'

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

export function createKeyRegistry({ namespace, getActiveProfileId } = {}) {
  if (!NAMESPACES.includes(namespace)) {
    throw new Error(`createKeyRegistry requires namespace 'nexusmd' or 'helm' (got ${JSON.stringify(namespace)})`)
  }
  const prefix = `${namespace}.`
  const secPrefix = `${namespace}.sec.`
  const otherAliasField = namespace // 'nexusmd' | 'helm': the ALIASES column for this platform
  const byName = new Map(ALIASES.map(r => [r[otherAliasField], r]))
  const byId = new Map(ALIASES.map(r => [r.id, r]))

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

  function classify(storageKey) {
    if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return null
    if (isSkippedKey(storageKey) || NEVER_SYNC.some(re => re.test(storageKey))) return null
    const { pid, name, rest } = parse(storageKey)
    if (!name) return null

    if (!pid && name === 'profiles') return { id: 'profiles', level: 'account' }
    if (!pid && name === 'activeProfileId') return { id: 'activeProfileId', level: 'device' }

    if (name === 'tweaks') {
      // Several profiles' tweaks would collide on one id: only the active profile's is synced.
      const active = activeProfile()
      if (pid && active && pid !== active) return null
      return { id: TWEAKS_ACCOUNT_ID, level: 'account', split: true, accountId: TWEAKS_ACCOUNT_ID, deviceId: TWEAKS_DEVICE_ID }
    }

    const level = DEVICE_LEVEL.some(re => re.test(name)) ? 'device' : 'account'
    const alias = byName.get(name)
    if (alias) return { id: pid ? `p.${pid}.${alias.id}` : alias.id, level }
    return { id: `${namespace}:${rest}`, level }
  }

  function toStorageKey(id) {
    if (typeof id !== 'string' || !id) return null
    let key = null

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
      key = tweaksKey()
    } else if (id === 'profiles' || id === 'activeProfileId') {
      key = `${prefix}${id}`
    } else {
      const m = /^(?:p\.([^.]+)\.)?(.+)$/.exec(id)
      const alias = m && byId.get(m[2])
      if (!alias) return null
      key = `${prefix}${m[1] ? `p.${m[1]}.` : ''}${alias[namespace]}`
    }

    // A remote id must never be able to name a key that is not synced in the first place.
    return classify(key) ? key : null
  }

  function splitTweaks(obj) {
    const account = {}
    const device = {}
    if (!isPlainObject(obj)) return { account, device }
    for (const [k, v] of Object.entries(obj)) {
      if (TWEAK_ACCOUNT_FIELDS.includes(k)) account[k] = v
      else device[k] = v
    }
    return { account, device }
  }

  function mergeTweaks(local, { account, device } = {}) {
    const out = isPlainObject(local) ? { ...local } : {}
    if (isPlainObject(account)) {
      for (const [k, v] of Object.entries(account)) if (TWEAK_ACCOUNT_FIELDS.includes(k)) out[k] = v
    }
    if (isPlainObject(device)) {
      for (const [k, v] of Object.entries(device)) if (!TWEAK_ACCOUNT_FIELDS.includes(k)) out[k] = v
    }
    return out
  }

  // Union by id, local order first. For the same id the remote's fields win (it is the newer
  // edit from another device); fields only the local has are kept. Nothing is ever deleted.
  const mergeProfiles = (local, remote) => {
    const out = []
    const index = new Map()
    const take = (list, overwrite) => {
      if (!Array.isArray(list)) return
      for (const p of list) {
        if (!isPlainObject(p) || typeof p.id !== 'string' || !p.id) continue
        if (index.has(p.id)) {
          if (overwrite) out[index.get(p.id)] = { ...out[index.get(p.id)], ...p }
        } else {
          index.set(p.id, out.length)
          out.push({ ...p })
        }
      }
    }
    take(local, false)
    take(remote, true)
    return out
  }

  // Secure-storage entries, found by the platform as localStorage keys starting with secPrefix.
  // Account secrets are never synced (secretId returns null for them).
  const secretId = (name) => (typeof name === 'string' && name && !isAccountSecretName(name) ? `sec:${namespace}:${name}` : null)
  const isSecretId = (id) => typeof id === 'string' && id.startsWith('sec:')
  // The secure-storage name for a secret id of this platform, null for the other platform's.
  const secretName = (id) => {
    const m = typeof id === 'string' ? /^sec:(nexusmd|helm):(.+)$/.exec(id) : null
    return m && m[1] === namespace && !isAccountSecretName(m[2]) ? m[2] : null
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
  }
}
