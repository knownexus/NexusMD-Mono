// packages/core/src/modules/devenv/profile.js
//
// The Profile tab's model: which kind of file a profile path is, validation before save, and
// edits to environment.json / mac.json that keep every field the form doesn't know about.
// The rules follow what devenv itself needs (Get-DevEnvServices, Get-MacConfig, test.ps1,
// profile.example/README.md), so the form never rejects a profile devenv accepts.

const KINDS = ['api', 'mobile', 'web']
const REPO_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
// Get-MacConfig's own checks.
const MAC_HOST = /^[A-Za-z0-9.-]+$/
const MAC_USER = /^[A-Za-z0-9._-]+$/

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = v => typeof v === 'string' && v.trim() !== ''
const isPort = v => Number.isInteger(v) && v >= 1 && v <= 65535

export function profileFileKind(path) {
  const p = String(path || '').replace(/\\/g, '/').toLowerCase()
  if (p === 'environment.json') return 'environment'
  if (p === 'mac.json') return 'mac'
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.yml') || p.endsWith('.yaml')) return 'yaml'
  return 'text'
}

// The same rule main applies, so a bad name is caught before anything is sent.
export function isProfilePath(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel)) return false
  return rel.split(/[\\/]/).every(p => p !== '' && p !== '.' && p !== '..')
}

export function textStyle(text) {
  const s = String(text ?? '')
  const i = s.indexOf('\n')
  return { bom: s.startsWith('﻿'), eol: i > 0 && s[i - 1] === '\r' ? '\r\n' : '\n' }
}

function lineCol(text, pos) {
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  return { line, column: pos - before.lastIndexOf('\n') }
}

export function parseJsonText(text) {
  const body = String(text ?? '').replace(/^﻿/, '')
  try {
    return { value: JSON.parse(body) }
  } catch (e) {
    const m = /position (\d+)/.exec(e.message)
    if (m) {
      const { line, column } = lineCol(body, Number(m[1]))
      return { error: `Not valid JSON (line ${line}, column ${column}): ${e.message}` }
    }
    return { error: `Not valid JSON: ${e.message}` }
  }
}

export function formatJson(value, style = { bom: false, eol: '\n' }) {
  const eol = style.eol === '\r\n' ? '\r\n' : '\n'
  const body = JSON.stringify(value, null, 2).replace(/\n/g, eol) + eol
  return style.bom ? '﻿' + body : body
}

function issues() {
  const errors = []
  const warnings = []
  return { errors, warnings, err: (at, message) => errors.push({ at, message }), warn: (at, message) => warnings.push({ at, message }) }
}

export function validateEnvironment(env) {
  const r = issues()
  if (!isObject(env)) { r.err('', 'environment.json must be a JSON object.'); return { errors: r.errors, warnings: r.warnings } }
  const repos = env.repositories
  if (!isObject(repos)) {
    r.err('repositories', '"repositories" must be an object of repositories by key.')
    return { errors: r.errors, warnings: r.warnings }
  }
  const keys = Object.keys(repos)
  if (!keys.length) r.warn('repositories', 'No repositories - devenv has nothing to run.')
  const ports = new Map()
  const notePort = (port, at) => {
    if (!isPort(port)) return
    if (ports.has(port)) r.warn(at, `Port ${port} is also used at ${ports.get(port)}.`)
    else ports.set(port, at)
  }
  const mobiles = []
  for (const key of keys) {
    const at = `repositories.${key}`
    const repo = repos[key]
    if (!REPO_KEY.test(key)) r.err(at, `"${key}" can't be a repository key - use letters, digits, - and _ (it becomes a folder name and "devenv build ${key}").`)
    if (!isObject(repo)) { r.err(at, `Repository "${key}" must be an object.`); continue }
    for (const f of ['source', 'ref', 'project']) {
      if (!isText(repo[f])) r.err(`${at}.${f}`, `"${f}" is required (text).`)
    }
    if (!KINDS.includes(repo.kind)) r.err(`${at}.kind`, '"kind" must be api, mobile or web.')
    if (repo.kind === 'mobile') mobiles.push(key)
    if (repo.port !== undefined) {
      if (!isPort(repo.port)) r.err(`${at}.port`, '"port" must be a whole number from 1 to 65535.')
      else notePort(repo.port, `${at}.port`)
    }
    for (const f of ['label', 'dll']) {
      if (repo[f] !== undefined && typeof repo[f] !== 'string') r.err(`${at}.${f}`, `"${f}" must be text.`)
    }
    for (const f of ['docker', 'start', 'migrationGuard']) {
      // devenv reads these with [bool]: the string "false" would count as true.
      if (repo[f] !== undefined && typeof repo[f] !== 'boolean') r.err(`${at}.${f}`, `"${f}" must be true or false.`)
    }
    if (repo.test !== undefined) {
      if (!isObject(repo.test)) r.err(`${at}.test`, '"test" must be an object with "port" and "db".')
      else {
        if (!isPort(repo.test.port)) r.err(`${at}.test.port`, 'The test stack port must be a whole number from 1 to 65535.')
        else notePort(repo.test.port, `${at}.test.port`)
        if (!isText(repo.test.db)) r.err(`${at}.test.db`, 'The test stack database ("db") is required.')
      }
    }
  }
  for (const key of mobiles) {
    if (key !== 'mobile') r.err(`repositories.${key}`, 'The mobile app\'s key must be "mobile".')
  }
  if (mobiles.length && !(isObject(env.mobile) && isText(env.mobile.packageId))) {
    r.warn('mobile.packageId', 'Set mobile.packageId - devenv needs it for the app\'s logs and installs.')
  }
  if (env.mobile !== undefined && !isObject(env.mobile)) r.err('mobile', '"mobile" must be an object.')
  else if (isObject(env.mobile) && env.mobile.packageId !== undefined && typeof env.mobile.packageId !== 'string') {
    r.err('mobile.packageId', '"packageId" must be text.')
  }

  if (env.database !== undefined) {
    const db = env.database
    if (!isObject(db)) r.err('database', '"database" must be an object.')
    else {
      for (const f of ['name', 'sourceContainer']) {
        if (db[f] !== undefined && typeof db[f] !== 'string') r.err(`database.${f}`, `"${f}" must be text.`)
      }
      if (db.databases !== undefined && !(Array.isArray(db.databases) && db.databases.every(isText))) {
        r.err('database.databases', '"databases" must be a list of database names.')
      }
    }
  }

  if (env.test !== undefined) {
    const t = env.test
    if (!isObject(t)) r.err('test', '"test" must be an object.')
    else {
      const testKeys = keys.filter(k => isObject(repos[k]) && repos[k].test !== undefined)
      if (t.defaultServices !== undefined) {
        if (!Array.isArray(t.defaultServices)) r.err('test.defaultServices', '"defaultServices" must be a list of repository keys.')
        else t.defaultServices.forEach((k, i) => {
          if (!testKeys.includes(k)) r.err(`test.defaultServices.${i}`, `"${k}" isn't a repository with a "test" block.`)
        })
      }
      for (const f of ['collection', 'collectionEnv']) {
        if (t[f] !== undefined && typeof t[f] !== 'string') r.err(`test.${f}`, `"${f}" must be text.`)
      }
      if (t.wiring !== undefined) {
        if (!Array.isArray(t.wiring)) r.err('test.wiring', '"wiring" must be a list.')
        else t.wiring.forEach((w, i) => {
          const at = `test.wiring.${i}`
          if (!isObject(w)) { r.err(at, 'Each wiring entry must be an object with from, to and key.'); return }
          for (const f of ['from', 'to']) {
            if (!keys.includes(w[f])) r.err(`${at}.${f}`, `"${f}" must be a repository key.`)
          }
          if (!isText(w.key)) r.err(`${at}.key`, 'The setting to point ("key") is required.')
          if (w.local !== undefined && typeof w.local !== 'string') r.err(`${at}.local`, '"local" must be text.')
          if (w.always !== undefined && typeof w.always !== 'boolean') r.err(`${at}.always`, '"always" must be true or false.')
        })
      }
      for (const f of ['extraDbConn', 'collectionPatterns']) {
        if (t[f] !== undefined && !(isObject(t[f]) && Object.values(t[f]).every(v => typeof v === 'string'))) {
          r.err(`test.${f}`, `"${f}" must be an object of text values.`)
        }
      }
    }
  }
  return { errors: r.errors, warnings: r.warnings }
}

export function validateMacConfig(mac) {
  const r = issues()
  if (!isObject(mac)) { r.err('', 'mac.json must be a JSON object.'); return { errors: r.errors, warnings: r.warnings } }
  if (!MAC_HOST.test(String(mac.host ?? ''))) r.err('host', '"host" must be the Mac\'s IP address or host name.')
  if (!MAC_USER.test(String(mac.user ?? ''))) r.err('user', '"user" must be your Mac login name.')
  if (mac.sshKey !== undefined && typeof mac.sshKey !== 'string') r.err('sshKey', '"sshKey" must be a file path.')
  return { errors: r.errors, warnings: r.warnings }
}

export function validateProfileFile(path, text, { parseYaml } = {}) {
  const kind = profileFileKind(path)
  if (kind === 'text') return { errors: [], warnings: [] }
  if (kind === 'yaml') {
    if (!parseYaml) return { errors: [], warnings: [] }
    try { parseYaml(String(text ?? '').replace(/^﻿/, '')); return { errors: [], warnings: [] } } catch (e) {
      return { errors: [{ at: '', message: `Not valid YAML: ${e?.message || e}` }], warnings: [] }
    }
  }
  const parsed = parseJsonText(text)
  if (parsed.error) return { errors: [{ at: '', message: parsed.error }], warnings: [] }
  if (kind === 'environment') return validateEnvironment(parsed.value)
  if (kind === 'mac') return validateMacConfig(parsed.value)
  return { errors: [], warnings: [] }
}

// ---------------------------------------------------------------- edits
// All immutable; existing keys keep their position, new ones go last.

export function setIn(obj, path, value) {
  if (!path.length) return value
  const [head, ...rest] = path
  const base = Array.isArray(obj) ? [...obj] : isObject(obj) ? { ...obj } : (typeof head === 'number' ? [] : {})
  if (!rest.length) {
    if (value === undefined) {
      if (Array.isArray(base)) base.splice(head, 1)
      else delete base[head]
    } else base[head] = value
    return base
  }
  const child = setIn(base[head], rest, value)
  // A delete that empties a parent removes the parent too (the form made it); an empty
  // object that was already in the file is never touched, because nothing was deleted in it.
  if (value === undefined && isObject(child) && !Object.keys(child).length && isObject(base[head]) && Object.keys(base[head]).length) {
    delete base[head]
  } else base[head] = child
  return base
}

function mapRepositories(env, fn) {
  const repos = isObject(env?.repositories) ? env.repositories : {}
  return { ...env, repositories: Object.fromEntries(fn(Object.entries(repos))) }
}

export function addRepository(env, key, kind = 'api') {
  if (isObject(env?.repositories) && Object.hasOwn(env.repositories, key)) throw new Error(`There is already a repository "${key}".`)
  return mapRepositories(env, entries => [...entries, [key, { source: '', ref: 'main', project: '', kind }]])
}

export function removeRepository(env, key) {
  return mapRepositories(env, entries => entries.filter(([k]) => k !== key))
}

export function moveRepository(env, key, delta) {
  return mapRepositories(env, entries => {
    const i = entries.findIndex(([k]) => k === key)
    const j = i + delta
    if (i < 0 || j < 0 || j >= entries.length) return entries
    const next = [...entries]
    const [item] = next.splice(i, 1)
    next.splice(j, 0, item)
    return next
  })
}

export function renameRepository(env, from, to) {
  if (from === to) return env
  if (isObject(env?.repositories) && Object.hasOwn(env.repositories, to)) throw new Error(`There is already a repository "${to}".`)
  let next = mapRepositories(env, entries => entries.map(([k, v]) => [k === from ? to : k, v]))
  const t = next.test
  if (isObject(t)) {
    const test = { ...t }
    if (Array.isArray(t.defaultServices)) test.defaultServices = t.defaultServices.map(k => (k === from ? to : k))
    if (Array.isArray(t.wiring)) {
      test.wiring = t.wiring.map(w => (isObject(w)
        ? { ...w, ...(w.from === from ? { from: to } : {}), ...(w.to === from ? { to } : {}) }
        : w))
    }
    next = { ...next, test }
  }
  return next
}

// Dotted paths of everything the forms don't edit, so the user can see it is kept.
const KNOWN = {
  top: ['name', 'repositories', 'database', 'mobile', 'test'],
  repo: ['source', 'ref', 'project', 'label', 'kind', 'port', 'dll', 'docker', 'start', 'migrationGuard', 'test'],
  repoTest: ['port', 'db'],
  database: ['name', 'databases', 'sourceContainer'],
  mobile: ['packageId'],
  test: ['defaultServices', 'collection', 'collectionEnv', 'wiring', 'extraDbConn', 'collectionPatterns'],
}

export function unknownEnvironmentFields(env) {
  if (!isObject(env)) return []
  const out = []
  const extra = (obj, known, prefix) => {
    if (isObject(obj)) for (const k of Object.keys(obj)) if (!known.includes(k)) out.push(prefix + k)
  }
  extra(env, KNOWN.top, '')
  if (isObject(env.repositories)) {
    for (const [key, repo] of Object.entries(env.repositories)) {
      extra(repo, KNOWN.repo, `repositories.${key}.`)
      if (isObject(repo)) extra(repo.test, KNOWN.repoTest, `repositories.${key}.test.`)
    }
  }
  extra(env.database, KNOWN.database, 'database.')
  extra(env.mobile, KNOWN.mobile, 'mobile.')
  extra(env.test, KNOWN.test, 'test.')
  return out
}

export function unknownMacFields(mac) {
  return isObject(mac) ? Object.keys(mac).filter(k => !['host', 'user', 'sshKey'].includes(k)) : []
}
