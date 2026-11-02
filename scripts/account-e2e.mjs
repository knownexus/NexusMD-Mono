// End-to-end check of NexusMD accounts (milestone 1) against a running local server.
//
//   API_BASE=http://127.0.0.1:5391 SETUP_TOKEN=... node scripts/account-e2e.mjs <path-to-accounts.db>
//
// Flow: admin setup -> invite -> invitee redeems -> "desktop A" (seeded ADO config, secrets,
// tweaks, device prefs) pushes -> "desktop B" (empty storages, new device) logs in and pulls.
// Asserts the values arrive, that the server only holds ciphertext (raw byte scan of the SQLite
// file and its -wal/-shm companions; the repo has no SQLite dependency), and exits non-zero on
// any failure. Uses the client's production PBKDF2 iteration count.
import fs from 'node:fs'
import path from 'node:path'
import {
  createAccountClient, createAccountSync, createKeyRegistry, makeProfileKeys,
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
function eq(a, b, label) {
  const same = JSON.stringify(a) === JSON.stringify(b)
  check(same, same ? label : `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)
}

// ---- fakes (same shapes the core tests use) --------------------------------------------------

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}
// Values live in a map; the engine enumerates names from `<ns>.sec.<name>` localStorage keys.
function fakeSecure(storage, ns, init = {}) {
  const vals = new Map()
  for (const [k, v] of Object.entries(init)) { vals.set(k, v); storage.setItem(`${ns}.sec.${k}`, 'opaque-blob') }
  return {
    get: async (n) => (vals.has(n) ? vals.get(n) : null),
    set: async (n, v) => { vals.set(n, v); storage.setItem(`${ns}.sec.${n}`, 'opaque-blob') },
    remove: async (n) => { vals.delete(n); storage.removeItem(`${ns}.sec.${n}`) },
  }
}
function memorySessionStore() {
  let s = null
  return { load: async () => s, save: async (v) => { s = v } }
}

// ---- values under test (unique per run so a raw scan is meaningful) --------------------------

const RUN = Math.random().toString(36).slice(2, 8)
const ORG = `contoso-org-${RUN}`
const PAT = `pat-secret-${RUN}-Zq81xK`
const SECRET_NAME = 'google.auth'
const SECRET_VALUE = `oauth-refresh-${RUN}-Wm27pL`
const THEME = `midnight-theme-${RUN}`
const WIDGET = `widget-device-${RUN}`
const PREFS_VALUE = `prefs-value-${RUN}`
const PASSWORD = `correct horse ${RUN} battery`
const ADMIN = `admin-${RUN}`
const USER = `alice-${RUN}`

const NS = 'nexusmd'
function makeDevice({ client, ck, deviceId, init = {}, secrets = {}, prefs = null }) {
  const storage = fakeStorage(init)
  const secure = fakeSecure(storage, NS, secrets)
  const registry = createKeyRegistry({ namespace: NS })
  const state = { prefs, applied: null }
  const devicePrefs = { collect: async () => state.prefs, apply: async (p) => { state.prefs = p; state.applied = p } }
  const sync = createAccountSync({
    client, containerKey: ck, registry, storage, secure, devicePrefs, deviceId,
    metaKey: `${NS}.account.meta`,
  })
  return { storage, secure, sync, state }
}

async function main() {
  console.log(`API_BASE=${API_BASE}`)

  console.log('Admin setup')
  const adminClient = createAccountClient({ baseUrl: API_BASE, sessionStore: memorySessionStore() })
  eq(await adminClient.status(), { needsSetup: true }, 'status reports needsSetup before setup')
  const adminLogin = await adminClient.setup({ setupToken: SETUP_TOKEN, username: ADMIN, password: PASSWORD })
  check(adminLogin.session.role === 'admin', 'setup creates an admin')
  eq(await adminClient.status(), { needsSetup: false }, 'status reports setup complete')

  console.log('Invite')
  const invite = await adminClient.createInvite({ ttlHours: 1 })
  check(typeof invite.code === 'string' && invite.code.length > 0, 'admin gets an invite code')
  const userClientA = createAccountClient({ baseUrl: API_BASE, sessionStore: memorySessionStore() })
  const redeemed = await userClientA.redeem({ inviteCode: invite.code, username: USER, password: PASSWORD })
  check(redeemed.session.role === 'user', 'invitee redeems into a normal user')
  const users = await adminClient.listUsers()
  check(users.some((u) => u.username === USER), 'admin sees the second user')

  console.log('Desktop A')
  await userClientA.logout()
  const { containerKey: ckA } = await userClientA.login({ username: USER, password: PASSWORD })
  const deviceA = await userClientA.createDevice({ name: 'desktop A', platform: 'windows' })
  const a = makeDevice({
    client: userClientA, ck: ckA, deviceId: deviceA.id,
    init: {
      [`${NS}.p.1.ado.org`]: ORG,
      [`${NS}.p.1.ado.projects`]: JSON.stringify(['ProjectOne']),
      [`${NS}.tweaks`]: JSON.stringify({ theme: THEME, density: 'compact', widgets: [WIDGET] }),
      [`${NS}.profiles`]: JSON.stringify([{ id: '1', name: 'Work' }]),
      [`${NS}.sidebar.width`]: '320',
    },
    secrets: { [SECRET_NAME]: SECRET_VALUE, 'ado.pat': PAT },
    prefs: { navOrder: [PREFS_VALUE] },
  })
  const pushed = await a.sync.seed()
  check(!pushed.error, `seed push has no error${pushed.error ? ` (${pushed.error.message})` : ''}`)
  check(pushed.pushed > 0, `items pushed (${pushed.pushed})`)
  check(pushed.devicePrefs === true, 'device prefs pushed')
  eq(pushed.conflicts, 0, 'no push conflicts')

  console.log('Desktop B (fresh install, same account, new device)')
  const userClientB = createAccountClient({ baseUrl: API_BASE, sessionStore: memorySessionStore() })
  const { containerKey: ckB } = await userClientB.login({ username: USER, password: PASSWORD })
  const devices = await userClientB.listDevices()
  check(devices.some((d) => d.id === deviceA.id && d.name === 'desktop A'), 'B sees desktop A in the device list')
  const deviceB = await userClientB.createDevice({ name: 'desktop B', platform: 'windows' })
  check(deviceB.id !== deviceA.id, 'B has its own device id')
  const b = makeDevice({ client: userClientB, ck: ckB, deviceId: deviceB.id })
  const pulled = await b.sync.pull()
  check(!pulled.error, `pull has no error${pulled.error ? ` (${pulled.error.message})` : ''}`)
  check(pulled.applied > 0, `entries applied on B (${pulled.applied})`)

  eq(b.storage.getItem(`${NS}.p.1.ado.org`), ORG, 'ADO org arrives')
  eq(b.storage.getItem(`${NS}.p.1.ado.projects`), JSON.stringify(['ProjectOne']), 'ADO projects arrive')
  eq(await b.secure.get('ado.pat'), PAT, 'ADO PAT (secret) arrives')
  eq(await b.secure.get(SECRET_NAME), SECRET_VALUE, 'OAuth secret arrives')
  eq(b.storage.getItem(`${NS}.profiles`), JSON.stringify([{ id: '1', name: 'Work' }]), 'profiles arrive')
  // activeProfileId is device-level, so B has none of its own: the restore makes the first profile
  // active, and the app's normal read path (makeProfileKeys, as shell-sdk binds it) finds the values.
  eq(b.storage.getItem(`${NS}.activeProfileId`), '1', 'B gets an active profile after a new-device restore')
  const { getProfileKey: keyOnB } = makeProfileKeys({ namespace: NS, getActiveId: () => b.storage.getItem(`${NS}.activeProfileId`) })
  eq(b.storage.getItem(keyOnB('ado.org')), ORG, "the app's profile-key read on B finds the ADO org")
  const tweaksB = JSON.parse(b.storage.getItem(`${NS}.tweaks`) || '{}')
  eq(tweaksB.theme, THEME, 'account-level tweak (theme) arrives')
  eq(tweaksB.density, 'compact', 'account-level tweak (density) arrives')
  check(!('widgets' in tweaksB), "A's device-level tweak (widgets) does not leak to B's device")
  check(b.storage.getItem(`${NS}.sidebar.width`) === null, "A's per-device sidebar width does not leak to B")
  check(b.state.applied === null, "A's device prefs are not applied to device B")

  console.log('Desktop A reinstall (wipe local data, log in, same device)')
  const a2 = makeDevice({ client: userClientA, ck: ckA, deviceId: deviceA.id })
  const restored = await a2.sync.pull()
  check(!restored.error, 'reinstall of device A pulls without error')
  eq(a2.storage.getItem(`${NS}.sidebar.width`), '320', 'per-device sidebar width is restored')
  eq(JSON.parse(a2.storage.getItem(`${NS}.tweaks`) || '{}').widgets, [WIDGET], 'device-level tweaks are restored')
  eq(a2.state.applied, { navOrder: [PREFS_VALUE] }, 'device prefs are restored')

  const adminFeed = await adminClient.getChanges(0)
  eq(adminFeed.items.length, 0, "the admin's feed is empty (accounts are isolated)")

  console.log('Server database scan')
  const dir = path.dirname(path.resolve(DB_PATH))
  const base = path.basename(DB_PATH)
  const files = fs.readdirSync(dir).filter((f) => f === base || f === `${base}-wal` || f === `${base}-shm`)
  check(files.includes(base), `database file found (${files.join(', ')})`)
  const bytes = Buffer.concat(files.map((f) => fs.readFileSync(path.join(dir, f))))
  console.log(`  scanned ${bytes.length} bytes`)
  // Positive control: usernames are stored in clear, so the scan can see text at all.
  check(bytes.includes(Buffer.from(USER)), 'control: scan finds the plaintext username')
  const forbidden = [
    ORG, PAT, SECRET_VALUE, THEME, WIDGET, PREFS_VALUE, PASSWORD,
    'ado.org', 'ado.pat', 'ado.projects', 'google.auth', 'tweaks', 'theme', 'density', 'sidebar.width', 'profiles', 'navOrder',
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
