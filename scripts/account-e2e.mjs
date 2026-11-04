// End-to-end check of NexusMD accounts ("profiles that sync everything") against a running local
// server started with Sync__MinFormat=2.
//
//   API_BASE=http://127.0.0.1:5391 SETUP_TOKEN=... node scripts/account-e2e.mjs <path-to-accounts.db>
//
// One way to run the server (no local .NET needed; the data directory holds accounts.db):
//   docker run --rm -p 5391:5391 -v "<repo>/apps/web:/repo:ro" -v "<data dir>:/data" \
//     -e ASPNETCORE_URLS=http://0.0.0.0:5391 -e Accounts__DbPath=/data/accounts.db \
//     -e Accounts__SetupToken=<token> -e Sync__MinFormat=2 -e RateLimit__PermitPerMinute=1000 \
//     mcr.microsoft.com/dotnet/sdk:8.0 sh -c "cp -r /repo /src && cd /src/server && dotnet run -p:SkipFrontend=true"
//
// Flow: admin setup -> invite -> redeem -> desktop A (two profiles: settings, a token, notes,
// tweaks) seeds -> desktop B (fresh) restores -> desktop C holds different notes before its first
// sync (nothing lost: distinct notes merge, the same id conflicts) -> one note edited on A and B
// (one conflict, Keep both -> two notes everywhere) -> a profile deleted on A shows deleted on B,
// is restored on B, then purged on A (the server holds only tombstones for it, both desktops are
// empty for it) -> a write without the sync-format header gets 426 -> a raw scan of the SQLite
// files finds no plaintext. Exits non-zero on any failure. Uses the production PBKDF2 count.
import fs from 'node:fs'
import path from 'node:path'
import {
  createAccountClient, createAccountSync, createKeyRegistry, decryptJson, opaqueId,
} from '../packages/core/src/index.js'

const API_BASE = process.env.API_BASE
const SETUP_TOKEN = process.env.SETUP_TOKEN
const DB_PATH = process.argv[2]
if (!API_BASE || !SETUP_TOKEN || !DB_PATH) {
  console.error('Usage: API_BASE=<url> SETUP_TOKEN=<token> node scripts/account-e2e.mjs <accounts.db path>')
  process.exit(2)
}

const failures = []
function check(cond, label) {
  if (cond) console.log(`  ok   ${label}`)
  else { console.log(`  FAIL ${label}`); failures.push(label) }
}
// Key order does not matter: synced records come back with their keys sorted.
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v)
function eq(a, b, label) {
  const same = JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
  check(same, same ? label : `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)
}
const noError = (r, label) => check(r && !r.error, `${label}${r && r.error ? ` (${r.error.code || ''} ${r.error.message})` : ''}`)

// ---- fakes (same shapes the core tests use) --------------------------------------------------

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}
// Values live in a map; the engine enumerates names from `<ns>.sec.<name>` localStorage keys.
function fakeSecure(storage, ns, init = {}) {
  const vals = new Map()
  for (const [k, v] of Object.entries(init)) { vals.set(k, v); storage.setItem(`${ns}.sec.${k}`, 'opaque-blob') }
  return {
    vals,
    get: async (n) => (vals.has(n) ? vals.get(n) : null),
    set: async (n, v) => { vals.set(n, v); storage.setItem(`${ns}.sec.${n}`, 'opaque-blob') },
    remove: async (n) => { vals.delete(n); storage.removeItem(`${ns}.sec.${n}`) },
  }
}
function memorySessionStore() {
  let s = null
  return { load: async () => s, save: async (v) => { s = v }, peek: () => s }
}

// ---- values under test (unique per run so a raw scan is meaningful) --------------------------

const RUN = Math.random().toString(36).slice(2, 8)
const ORG = `contoso-org-${RUN}`
const HOME_ORG = `home-org-${RUN}`
const PAT = `pat-secret-${RUN}-Zq81xK`
const OAUTH = `oauth-refresh-${RUN}-Wm27pL`
const THEME = `midnight-theme-${RUN}`
const NOTE_A = `note from A ${RUN}`
const NOTE_C = `note from C ${RUN}`
const PASSWORD = `correct horse ${RUN} battery`
const ADMIN = `admin-${RUN}`
const USER = `alice-${RUN}`

const NS = 'nexusmd'
const PROFILES = `${NS}.profiles`
const DOCS_W = `${NS}.p.W.md_documents`
const N1 = `${NS}:p.W.md_documents#n1`
const prof = (id, name) => ({ id, name, updatedAt: 1, deletedAt: null, purgedAt: null })
const docsOf = (d) => JSON.parse(d.storage.getItem(DOCS_W) || '{"docs":[]}').docs
const profilesOf = (d) => JSON.parse(d.storage.getItem(PROFILES) || '[]')
const setDocs = (d, docs) => d.storage.setItem(DOCS_W, JSON.stringify({ docs }))
const doc = (id, content) => ({ id, name: id, content })

function makeDevice({ client, ck, deviceId, init = {}, secrets = {} }) {
  const storage = fakeStorage(init)
  const secure = fakeSecure(storage, NS, secrets)
  const registry = createKeyRegistry({ namespace: NS })
  const sync = createAccountSync({ client, containerKey: ck, registry, storage, secure, deviceId, metaKey: `${NS}.account.meta` })
  return { storage, secure, sync }
}

async function login(label) {
  const sessions = memorySessionStore()
  const client = createAccountClient({ baseUrl: API_BASE, sessionStore: sessions })
  const { containerKey } = await client.login({ username: USER, password: PASSWORD })
  const device = await client.createDevice({ name: label, platform: 'windows' })
  return { client, ck: containerKey, deviceId: device.id, sessions }
}

/** The decrypted server payload of a canonical id (or undefined). */
async function serverItem(client, ck, id) {
  const wid = await opaqueId(id, ck)
  let cursor = 0
  let found
  for (;;) {
    const page = await client.getChanges(cursor, 500)
    for (const it of page.items) if (it.id === wid) found = it
    if (!page.items.length || !page.hasMore) break
    cursor = page.cursor
  }
  if (!found) return undefined
  return decryptJson(found.ciphertext, ck, `nexusmd-item|${wid}`)
}

async function main() {
  console.log(`API_BASE=${API_BASE}`)

  console.log('Admin setup and invite')
  const adminClient = createAccountClient({ baseUrl: API_BASE, sessionStore: memorySessionStore() })
  eq(await adminClient.status(), { needsSetup: true }, 'status reports needsSetup before setup')
  const adminLogin = await adminClient.setup({ setupToken: SETUP_TOKEN, username: ADMIN, password: PASSWORD })
  check(adminLogin.session.role === 'admin', 'setup creates an admin')
  const invite = await adminClient.createInvite({ ttlHours: 1 })
  const redeemer = createAccountClient({ baseUrl: API_BASE, sessionStore: memorySessionStore() })
  const redeemed = await redeemer.redeem({ inviteCode: invite.code, username: USER, password: PASSWORD })
  check(redeemed.session.role === 'user', 'invitee redeems into a normal user')

  console.log('Desktop A seeds two profiles')
  const la = await login('desktop A')
  const a = makeDevice({
    ...la,
    init: {
      [PROFILES]: JSON.stringify([prof('W', 'Work'), prof('H', 'Home')]),
      [`${NS}.activeProfileId`]: 'W',
      [`${NS}.p.W.ado.org`]: ORG,
      [`${NS}.p.H.ado.org`]: HOME_ORG,
      [`${NS}.p.W.tweaks`]: JSON.stringify({ theme: THEME }),
      [DOCS_W]: JSON.stringify({ docs: [doc('n1', NOTE_A)] }),
      [`${NS}.sidebar.width`]: '320',
    },
    secrets: { [`${NS}.p.W.ado.pat`]: PAT, [`${NS}.p.W.google.auth`]: OAUTH },
  })
  const seeded = await a.sync.seed()
  noError(seeded, 'seed has no error')
  check(seeded.pushed > 0, `items pushed (${seeded.pushed})`)

  console.log('Desktop B (fresh install) restores')
  const lb = await login('desktop B')
  const b = makeDevice(lb)
  noError(await b.sync.syncNow(), 'B syncs without error')
  eq(b.storage.getItem(`${NS}.p.W.ado.org`), ORG, 'a profile setting arrives')
  eq(await b.secure.get(`${NS}.p.W.ado.pat`), PAT, 'the profile token arrives in secure storage')
  eq(await b.secure.get(`${NS}.p.W.google.auth`), OAUTH, 'the OAuth sign-in arrives')
  eq(JSON.parse(b.storage.getItem(`${NS}.p.W.tweaks`) || '{}').theme, THEME, 'a tweak arrives field by field')
  eq(docsOf(b), [doc('n1', NOTE_A)], 'the note arrives')
  eq(b.storage.getItem(`${NS}.activeProfileId`), 'W', 'B gets an active profile')
  check(b.storage.getItem(`${NS}.sidebar.width`) === null, "A's window width stays on A")

  console.log('Desktop C held different notes before its first sync')
  const lc = await login('desktop C')
  const c = makeDevice({ ...lc, init: { [DOCS_W]: JSON.stringify({ docs: [doc('n1', NOTE_C), doc('n2', NOTE_C)] }) } })
  noError(await c.sync.syncNow(), 'C syncs without error')
  eq(docsOf(c), [doc('n1', NOTE_C), doc('n2', NOTE_C)], "C's own notes are all kept")
  eq(c.sync.conflicts().map((x) => x.id), [N1], 'the note with the same id is one conflict on C')
  eq(JSON.parse((await serverItem(lc.client, lc.ck, N1)).value).content, NOTE_A, "the server keeps A's version of it")
  noError(await a.sync.syncNow(), 'A syncs without error')
  eq(docsOf(a).map((d) => d.id), ['n1', 'n2'], "C's distinct note reached A")
  eq(await c.sync.resolve(N1, { take: 'remote' }), {}, 'C takes the server version of n1')

  console.log('The same note edited on A and B')
  await b.sync.syncNow()
  setDocs(a, [doc('n1', `${NOTE_A} edited on A`), doc('n2', NOTE_C)])
  noError(await a.sync.syncNow(), 'A pushes its edit')
  setDocs(b, [doc('n1', `${NOTE_A} edited on B`), doc('n2', NOTE_C)])
  noError(await b.sync.syncNow(), 'B syncs')
  eq(b.sync.conflicts().map((x) => x.id), [N1], 'B holds exactly one conflict')
  eq(await b.sync.keepBoth(N1, { copyName: (n) => `${n} (conflicted copy, desktop A, 2026-11-04)` }), {}, 'B keeps both')
  noError(await b.sync.syncNow(), 'B pushes both')
  noError(await a.sync.syncNow(), 'A pulls both')
  for (const [d, label] of [[a, 'A'], [b, 'B']]) {
    const docs = docsOf(d)
    eq(docs.length, 3, `${label} has n1, its copy and n2`)
    eq(docs.find((x) => x.id === 'n1').content, `${NOTE_A} edited on B`, `${label}: n1 holds B's edit`)
    check(docs.some((x) => /^n1-c\d+$/.test(x.id) && x.content === `${NOTE_A} edited on A` && x.name.endsWith('(conflicted copy, desktop A, 2026-11-04)')),
      `${label}: the conflicted copy holds A's edit`)
  }

  console.log('A profile deleted, restored, then purged')
  const now = Date.now()
  a.storage.setItem(PROFILES, JSON.stringify(profilesOf(a).map((p) => (p.id === 'H' ? { ...p, deletedAt: now, updatedAt: now } : p))))
  noError(await a.sync.syncNow(), 'A syncs the deletion')
  noError(await b.sync.syncNow(), 'B syncs')
  check(!!profilesOf(b).find((p) => p.id === 'H').deletedAt, 'B lists Home as deleted')
  eq(b.storage.getItem(`${NS}.p.H.ado.org`), HOME_ORG, "a deleted profile's data stays")
  b.storage.setItem(PROFILES, JSON.stringify(profilesOf(b).map((p) => (p.id === 'H' ? { ...p, deletedAt: null, updatedAt: now + 1000 } : p))))
  noError(await b.sync.syncNow(), 'B syncs the restore')
  noError(await a.sync.syncNow(), 'A syncs')
  eq(profilesOf(a).find((p) => p.id === 'H').deletedAt, null, 'A sees Home restored')
  eq(await a.sync.purgeProfile('H'), {}, 'A purges Home')
  noError(await b.sync.syncNow(), 'B syncs the purge')
  const homeItem = await serverItem(la.client, la.ck, 'p.H.ado.org')
  eq(homeItem && homeItem.deleted, true, "the server holds only a tombstone for Home's setting")
  for (const [d, label] of [[a, 'A'], [b, 'B']]) {
    eq(d.storage.keys().filter((k) => k.includes('.p.H.')), [], `${label} holds nothing of Home`)
    check(!!profilesOf(d).find((p) => p.id === 'H').purgedAt, `${label} keeps Home as a tombstone`)
  }
  eq(b.sync.pendingPurges(), [], 'B had nothing unpushed for Home: no pending purge')

  console.log('Sync-format gate')
  const token = la.sessions.peek().accessToken
  const res = await fetch(`${API_BASE}/api/items/e2e-format-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ciphertext: "x", deleted: false }),
  })
  eq(res.status, 426, 'a write without X-Sync-Format 2 gets 426')
  eq((await res.json().catch(() => ({}))).code, 'client_outdated', 'with code client_outdated')

  const adminFeed = await adminClient.getChanges(0)
  eq(adminFeed.items.length, 0, "the admin's feed is empty (accounts are isolated)")

  console.log('Server database scan')
  const dir = path.dirname(path.resolve(DB_PATH))
  const base = path.basename(DB_PATH)
  const files = fs.readdirSync(dir).filter((f) => f === base || f === `${base}-wal` || f === `${base}-shm`)
  check(files.includes(base), `database file found (${files.join(', ')})`)
  const bytes = Buffer.concat(files.map((f) => fs.readFileSync(path.join(dir, f))))
  console.log(`  scanned ${bytes.length} bytes`)
  check(bytes.includes(Buffer.from(USER)), 'control: scan finds the plaintext username')
  const forbidden = [
    ORG, HOME_ORG, PAT, OAUTH, THEME, NOTE_A, NOTE_C, PASSWORD, 'conflicted copy',
    'ado.org', 'ado.pat', 'google.auth', 'md_documents', 'tweaks', 'theme', 'profiles', 'purgedAt', 'deletedAt',
  ]
  for (const s of forbidden) check(!bytes.includes(Buffer.from(s)), `server DB does not contain "${s}"`)
}

try {
  await main()
} catch (e) {
  console.log(`  FAIL unexpected error: ${e && e.stack ? e.stack : e}`)
  failures.push('unexpected error')
}
if (failures.length) {
  console.log(`\nFAIL (${failures.length} failed)`)
  process.exit(1)
}
console.log('\nPASS')
