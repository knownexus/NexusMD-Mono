// migrate-v2.js — the one-time move of the desktop's remaining global user data into profiles,
// and of plaintext tokens into secure storage ("Profiles that sync everything", Task 8).
//
// Before profiles held everything, the desktop kept some user data under global keys (some not
// even under `nexusmd.`: `nx-db:*`, `md_*`, ...). The code now reads them per profile
// (`nexusmd.p.<pid>.<name>`); this moves what is still global:
//   - settings are copied into EVERY profile (each profile starts with the machine's settings);
//   - content and credentials go to the ACTIVE profile only;
//   - a value the profile already has is never overwritten (a list of people merges by id);
//   - the global keys are removed afterwards; the global caches are simply dropped.
// Content that loses to the profile's own, different copy is kept on this machine (never synced)
// under `nexusmd.migrated.v2.backup.<old key>` rather than thrown away.
//
// Tokens (`ado.pat`, `github.pat`, `jira.apiToken`, `<provider>.auth`) kept in plain localStorage
// move into secure storage under the same name (`nexusmd.p.<pid>.<field>`), which is what the
// key registry syncs them as. That sweep runs on every call, marker or not, since importing a
// profile bundle or a settings file can bring plain tokens back.
//
// Safety: every copy is written and read back before any source is removed. If a copy fails,
// everything written so far is undone, nothing is removed, the marker is not set, and the error
// is thrown: the data is as it was and the next start tries again. The marker
// (`nexusmd.migrated.v2`) is device level and never synced (the registry ignores global keys).
//
// Headless: `storage` is a Web Storage (getItem/setItem/removeItem/key/length) and `secure` the
// platform's secure-storage adapter (async get/set/remove by name; set may fail silently, so
// every secure write is verified with a get).

import { rendererLog, ignore } from '../../log.js'

const log = rendererLog('core', 'profiles')
const NS = 'nexusmd'
export const MIGRATION_V2_MARKER = `${NS}.migrated.v2`
const BACKUP_PREFIX = `${MIGRATION_V2_MARKER}.backup.`

const TOKEN_FIELDS = ['ado.pat', 'github.pat', 'jira.apiToken']
const AUTH_PROVIDERS = ['gdrive', 'onedrive', 'ado', 'microsoft', 'github', 'google']
const TOKEN_NAMES = [...TOKEN_FIELDS, ...AUTH_PROVIDERS.map(p => `${p}.auth`)]

/** Every token of a profile, by its secure-storage name (`<ns>.p.<pid>.<field>`). */
export function profileTokenNames(namespace, pid) {
  return TOKEN_NAMES.map(n => `${namespace}.p.${pid}.${n}`)
}

const EVERY = 'every'   // a setting: copied into every profile
const ACTIVE = 'active' // content or a credential: the active profile only

// `nexusmd.<name>` settings, carried under the same name.
const NS_SETTINGS = new Set([
  'tweaks', 'refreshInterval', 'markdown.textSize', 'projectAreas.v3', 'confidential.autoRelock',
  'settings.collapsed', 'outputPath',
])
// Global caches: rebuilt per profile by the code, so dropped rather than carried.
const NS_DROPPED = new Set(['ado.cache.v1', 'jira.cache.v1', 'github.cache.v1', 'workitems.status.v1'])

const FIXED = {
  'nexusmd_seen_pr': { name: 'seenPr', scope: EVERY },
  'nx-gw-branch-commits-collapsed': { name: 'branchCommitsCollapsed', scope: EVERY },
  'md_learn_mode': { name: 'md_learn_mode', scope: EVERY },
  'md_cheatsheet_open': { name: 'md_cheatsheet_open', scope: EVERY },
  'md_learning_progress': { name: 'md_learning_progress', scope: EVERY },
  'md_documents': { name: 'md_documents', scope: ACTIVE },
  'nx-db:list-hidden': { name: 'dbManager.listHidden', scope: EVERY },
  'nx-db:last-type': { name: 'dbManager.lastType', scope: EVERY },
  'nx-db:saved-queries': { name: 'dbManager.savedQueries', scope: ACTIVE },
  'nx-db:open-connections': { name: 'dbManager.openConnections', scope: ACTIVE },
}
const DB_PER_CONNECTION = [
  ['nx-db:tables:', 'dbManager.tables.'],
  ['nx-db:starred:', 'dbManager.starred.'],
  ['nx-db:other-schemas:', 'dbManager.otherSchemas.'],
]

// The rule for one global key: { name, scope, merge? }, { drop: true }, or null (not ours: left alone).
function ruleFor(key) {
  if (key.startsWith(`${NS}.`)) {
    const bare = key.slice(NS.length + 1)
    if (NS_SETTINGS.has(bare)) return { name: bare, scope: EVERY }
    if (NS_DROPPED.has(bare)) return { drop: true }
    if (bare === 'team.notes') return { name: bare, scope: ACTIVE }
    if (bare === 'team.custom') return { name: bare, scope: ACTIVE, merge: 'id' }
    return null
  }
  if (Object.prototype.hasOwnProperty.call(FIXED, key)) return FIXED[key]
  for (const [from, to] of DB_PER_CONNECTION) {
    if (key.startsWith(from) && key.length > from.length) return { name: to + key.slice(from.length), scope: EVERY }
  }
  if (key.startsWith('nx-db:min-cols:')) {
    // `nx-db:min-cols:<conn>:<table>`; the connection key may itself hold colons (`demo:/`), a table does not.
    const rest = key.slice('nx-db:min-cols:'.length)
    const i = rest.lastIndexOf(':')
    if (i <= 0 || i === rest.length - 1) return null
    return { name: `dbManager.minCols.${rest.slice(0, i)}.${rest.slice(i + 1)}`, scope: EVERY }
  }
  return null
}

const keysOf = (storage) => {
  const keys = []
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k) keys.push(k) }
  return keys.sort()
}

const parseList = (raw) => {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null } catch { return null }
}

// The existing list, then each incoming entry whose id it does not have yet.
function mergeById(existing, incoming) {
  const ids = new Set(existing.map(e => e && e.id).filter(id => id != null))
  const out = [...existing]
  for (const e of incoming) {
    if (e && e.id != null && ids.has(e.id)) continue
    out.push(e)
    if (e && e.id != null) ids.add(e.id)
  }
  return out
}

// Copies with undo: storage writes remember the value they replaced, secure writes the names
// they created.
function makeJournal(storage, secure) {
  const writes = []
  const secureNew = []
  return {
    set(key, value) {
      const prev = storage.getItem(key)
      storage.setItem(key, value)
      writes.push({ key, prev })
      if (storage.getItem(key) !== value) throw new Error(`migration: ${key} did not save`)
    },
    async secureCopy(name, value) {
      await secure.set(name, value)
      secureNew.push(name)
      if ((await secure.get(name)) !== value) throw new Error(`migration: secure ${name} did not save`)
    },
    async undo() {
      for (const { key, prev } of writes.reverse()) {
        try { if (prev === null) storage.removeItem(key); else storage.setItem(key, prev) } catch (err) { ignore(log, 'undoing a migration write failed (best effort)', err, 'warn', { key }) }
      }
      for (const name of secureNew.reverse()) { try { await secure.remove(name) } catch (err) { ignore(log, 'removing a secret written by a migration failed (best effort)', err, 'warn', { name }) } }
    },
  }
}

// Plan + copy of the secure-storage moves: plain tokens, and (with an active profile) the
// API-client secrets kept under their global name. Returns the sources to remove once all is safe.
async function copySecure({ storage, secure, journal, activeProfileId }) {
  const secPrefix = `${NS}.sec.`
  const tokenRe = new RegExp(`^${NS}\\.p\\.([^.#]+)\\.(${TOKEN_NAMES.map(n => n.replace(/\./g, '\\.')).join('|')})$`)
  const removePlain = []
  const removeSecure = []
  const failures = []
  for (const key of keysOf(storage)) {
    if (tokenRe.test(key)) {
      const value = storage.getItem(key)
      if (value === null) continue
      try {
        if ((await secure.get(key)) === null) await journal.secureCopy(key, value)
        removePlain.push(key) // a token already in secure storage wins
      } catch (err) { failures.push(err) }
      continue
    }
    const old = key.startsWith(secPrefix) ? key.slice(secPrefix.length) : null
    if (activeProfileId && old && old.startsWith(`${NS}.apiClient.secret.`)) {
      const value = await secure.get(old)
      if (value === null) continue // unreadable: left where it is, never lost
      const target = `${NS}.p.${activeProfileId}.${old.slice(NS.length + 1)}`
      const existing = await secure.get(target)
      try {
        if (existing === null) { await journal.secureCopy(target, value); removeSecure.push(old) }
        else if (existing === value) removeSecure.push(old)
        // a different value already under the profile: the global one stays rather than being lost
      } catch (err) { failures.push(err) }
    }
  }
  if (failures.length) throw new Error(failures.map(e => e.message).join('; '))
  return { removePlain, removeSecure }
}

function copyGlobals({ storage, journal, profiles, activeProfileId }) {
  const remove = []
  for (const key of keysOf(storage)) {
    const rule = ruleFor(key)
    if (!rule) continue
    const value = storage.getItem(key)
    if (value === null) continue
    remove.push(key)
    if (rule.drop) continue
    let backup = false
    for (const pid of rule.scope === EVERY ? profiles : [activeProfileId]) {
      const target = `${NS}.p.${pid}.${rule.name}`
      const existing = storage.getItem(target)
      if (existing === null) { journal.set(target, value); continue }
      if (existing === value) continue
      if (rule.merge === 'id') {
        const mine = parseList(existing)
        const theirs = parseList(value)
        if (mine && theirs) {
          const merged = JSON.stringify(mergeById(mine, theirs))
          if (merged !== existing) journal.set(target, merged)
          continue
        }
      }
      if (rule.scope === ACTIVE) backup = true // content the profile's own copy beat: kept, not lost
    }
    if (backup) {
      // A later run (after a settings import cleared the marker) never overwrites an earlier backup.
      let name = BACKUP_PREFIX + key
      for (let n = 2; storage.getItem(name) !== null && storage.getItem(name) !== value; n++) name = `${BACKUP_PREFIX}${key}.${n}`
      if (storage.getItem(name) === null) journal.set(name, value)
    }
  }
  return remove
}

/**
 * Move plaintext tokens into secure storage (every profile), verified before the plain key goes.
 * @returns {Promise<{ moved: string[] }>}
 */
export async function moveTokensToSecureStorage({ storage, secure, namespace = NS }) {
  if (namespace !== NS) throw new Error(`moveTokensToSecureStorage is desktop only (got ${JSON.stringify(namespace)})`)
  const journal = makeJournal(storage, secure)
  let plan
  try { plan = await copySecure({ storage, secure, journal, activeProfileId: '' }) }
  catch (err) { await journal.undo(); throw err }
  for (const key of plan.removePlain) storage.removeItem(key)
  return { moved: plan.removePlain }
}

/**
 * The one-time move of global user data into profiles (see the top of this file).
 * @param {{ storage: Storage, secure: { get, set, remove }, namespace?: 'nexusmd', profiles: string[], activeProfileId: string }} opts
 * @returns {Promise<{ moved: string[] }>} the global keys / secret names that moved (or were dropped)
 */
export async function migrateToProfileScopeV2({ storage, secure, namespace = NS, profiles = [], activeProfileId = '' }) {
  if (namespace !== NS) throw new Error(`migrateToProfileScopeV2 is desktop only (got ${JSON.stringify(namespace)})`)
  const ids = [...new Set((profiles || []).filter(id => typeof id === 'string' && id && !id.includes('.')))]
  // No profile to own the data yet (first run): nothing moves, and the next start tries again.
  if (!activeProfileId || !ids.includes(activeProfileId)) return { moved: [] }
  if (storage.getItem(MIGRATION_V2_MARKER) === '1') return moveTokensToSecureStorage({ storage, secure, namespace })

  const journal = makeJournal(storage, secure)
  let secureSources, globalSources
  try {
    secureSources = await copySecure({ storage, secure, journal, activeProfileId })
    globalSources = copyGlobals({ storage, journal, profiles: ids, activeProfileId })
  } catch (err) {
    await journal.undo()
    throw err
  }
  // Every copy is in place and read back: only now do the sources go.
  for (const key of [...secureSources.removePlain, ...globalSources]) storage.removeItem(key)
  for (const name of secureSources.removeSecure) await secure.remove(name)
  storage.setItem(MIGRATION_V2_MARKER, '1')
  return { moved: [...secureSources.removePlain, ...secureSources.removeSecure, ...globalSources] }
}
