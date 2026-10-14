// packages/core/src/modules/devenv/profile.js
//
// The devenv profile as the Profile tab edits it: which editor a file gets, what must be true
// before it may be saved (devenv itself never validates environment.json - a bad one only fails
// later, deep inside start or build), and immutable edits for the environment.json form.

import { parseAllDocuments } from 'yaml'

export const REPOSITORY_KEY = /^[a-z][a-z0-9-]*$/
const KINDS = ['api', 'mobile', 'web']
const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const MAC_HOST = /^[A-Za-z0-9.-]+$/
const MAC_USER = /^[A-Za-z0-9._-]+$/

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string' && v.trim() !== ''
const isPort = v => Number.isInteger(v) && v > 0 && v < 65536

export function profileFileKind(path) {
  const name = String(path).toLowerCase()
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml'
  if (/\.ps(m|d)?1$/.test(name)) return 'powershell'
  if (name.endsWith('.sql')) return 'sql'
  if (name.endsWith('.md')) return 'markdown'
  return 'text'
}

export function validateEnvironment(env) {
  const errors = []
  const err = (path, message) => errors.push({ path, message })
  if (!isObj(env)) { err('', 'environment.json must be a JSON object.'); return errors }
  if (env.name !== undefined && typeof env.name !== 'string') err('name', 'name must be text.')
  const repos = isObj(env.repositories) ? env.repositories : null
  const keys = repos ? Object.keys(repos) : []
  if (!keys.length) err('repositories', 'repositories needs at least one repository.')
  for (const key of keys) {
    const r = repos[key]
    const at = f => `repositories.${key}${f ? `.${f}` : ''}`
    if (!REPOSITORY_KEY.test(key)) err(at(), `"${key}": repository names are lower-case letters, digits and -, starting with a letter.`)
    if (!isObj(r)) { err(at(), `${key} must be an object.`); continue }
    for (const f of ['source', 'ref', 'project']) if (!isStr(r[f])) err(at(f), `${key}: ${f} is required.`)
    if (isStr(r.ref) && r.ref.trim().startsWith('-')) err(at('ref'), `${key}: ref can't start with '-'.`)
    if (!KINDS.includes(r.kind)) err(at('kind'), `${key}: kind must be api, mobile or web.`)
    else if (r.kind === 'mobile' && key !== 'mobile') err(at('kind'), `The mobile app's repository must be named "mobile" (not "${key}").`)
    if (key === 'mobile' && KINDS.includes(r.kind) && r.kind !== 'mobile') err(at('kind'), 'The "mobile" repository must have kind mobile.')
    if (r.port !== undefined && !isPort(r.port)) err(at('port'), `${key}: port must be a whole number from 1 to 65535.`)
    for (const f of ['label', 'dll']) if (r[f] !== undefined && typeof r[f] !== 'string') err(at(f), `${key}: ${f} must be text.`)
    for (const f of ['docker', 'start', 'migrationGuard']) if (r[f] !== undefined && typeof r[f] !== 'boolean') err(at(f), `${key}: ${f} must be true or false.`)
    if (r.test !== undefined) {
      if (!isObj(r.test)) err(at('test'), `${key}: test must be an object with port and db.`)
      else {
        if (!isPort(r.test.port)) err(at('test.port'), `${key}: test.port must be a whole number from 1 to 65535.`)
        if (!isStr(r.test.db)) err(at('test.db'), `${key}: test.db is required.`)
      }
    }
  }
  if (keys.some(k => repos[k]?.kind === 'mobile') && !isStr(env.mobile?.packageId)) err('mobile.packageId', 'A mobile repository needs mobile.packageId (the app id, e.g. com.example.app).')
  if (env.database !== undefined) {
    const d = env.database
    if (!isObj(d)) err('database', 'database must be an object.')
    else {
      if (d.name !== undefined && typeof d.name !== 'string') err('database.name', 'database.name must be text.')
      if (d.databases !== undefined && (!Array.isArray(d.databases) || !d.databases.every(isStr))) err('database.databases', 'database.databases must be a list of names.')
      if (d.sourceContainer !== undefined && d.sourceContainer !== '' && !CONTAINER.test(String(d.sourceContainer))) err('database.sourceContainer', 'database.sourceContainer must be a container name (letters, digits, _ . -).')
    }
  }
  if (env.test !== undefined) {
    const t = env.test
    if (!isObj(t)) err('test', 'test must be an object.')
    else {
      const testKeys = keys.filter(k => isObj(repos[k]?.test))
      if (t.defaultServices !== undefined) {
        if (!Array.isArray(t.defaultServices)) err('test.defaultServices', 'test.defaultServices must be a list.')
        else for (const s of t.defaultServices) if (!testKeys.includes(s)) err('test.defaultServices', `test.defaultServices: "${s}" isn't a repository with a test block.`)
      }
      for (const f of ['collection', 'collectionEnv']) if (t[f] !== undefined && typeof t[f] !== 'string') err(`test.${f}`, `test.${f} must be text.`)
      if (t.wiring !== undefined) {
        if (!Array.isArray(t.wiring)) err('test.wiring', 'test.wiring must be a list.')
        else t.wiring.forEach((w, i) => {
          const n = i + 1
          if (!isObj(w)) { err(`test.wiring.${i}`, `test.wiring ${n} must be an object.`); return }
          for (const f of ['from', 'to']) if (!keys.includes(w[f])) err(`test.wiring.${i}.${f}`, `test.wiring ${n}: ${f} must be one of the repositories.`)
          if (!isStr(w.key)) err(`test.wiring.${i}.key`, `test.wiring ${n}: key (the setting name) is required.`)
          if (w.always !== undefined && typeof w.always !== 'boolean') err(`test.wiring.${i}.always`, `test.wiring ${n}: always must be true or false.`)
        })
      }
      for (const f of ['extraDbConn', 'collectionPatterns']) if (t[f] !== undefined && !isObj(t[f])) err(`test.${f}`, `test.${f} must be an object.`)
      if (repos && isObj(t.collectionPatterns)) {
        for (const [pattern, value] of Object.entries(t.collectionPatterns)) {
          if (typeof value !== 'string' || !keys.includes(value)) err(`test.collectionPatterns.${pattern}`, `test.collectionPatterns "${pattern}" points at "${value}", which isn't a repository.`)
        }
      }
    }
  }
  return errors
}

export function validateMac(mac) {
  if (!isObj(mac)) return [{ path: '', message: 'mac.json must be a JSON object.' }]
  const errors = []
  if (!MAC_HOST.test(String(mac.host ?? ''))) errors.push({ path: 'host', message: "host must be the Mac's IP address or host name." })
  if (!MAC_USER.test(String(mac.user ?? ''))) errors.push({ path: 'user', message: 'user must be your Mac login name.' })
  if (mac.sshKey !== undefined && typeof mac.sshKey !== 'string') errors.push({ path: 'sshKey', message: 'sshKey must be a file path.' })
  return errors
}

function jsonError(e, text) {
  const message = String(e?.message || e)
  const ln = /line (\d+)/.exec(message)
  const pos = /position (\d+)/.exec(message)
  const line = ln ? Number(ln[1]) : pos ? text.slice(0, Number(pos[1])).split('\n').length : null
  return { message, line }
}

export function validateProfileFile(path, text) {
  const kind = profileFileKind(path)
  const name = String(path).replace(/\\/g, '/').toLowerCase()
  if (kind === 'json') {
    let value
    try { value = JSON.parse(text) } catch (e) { return [jsonError(e, text)] }
    if (name === 'environment.json') return validateEnvironment(value).map(e => ({ ...e, line: null }))
    if (name === 'mac.json') return validateMac(value).map(e => ({ ...e, line: null }))
    return []
  }
  if (kind === 'yaml') {
    const out = []
    for (const doc of parseAllDocuments(text)) for (const e of doc.errors ?? []) out.push({ message: e.message, line: e.linePos?.[0]?.line ?? null })
    return out
  }
  return []
}

export const detectEol = text => (/\r\n/.test(text) ? '\r\n' : '\n')
export const toLf = text => text.replace(/\r\n/g, '\n')
export const fromLf = (text, eol) => (eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text)
export const formatJson = obj => `${JSON.stringify(obj, null, 2)}\n`

export function setIn(obj, keys, value) {
  const [k, ...rest] = keys
  const base = Array.isArray(obj) ? [...obj] : { ...(isObj(obj) ? obj : {}) }
  if (!rest.length) {
    if (value === undefined && !Array.isArray(base)) delete base[k]
    else base[k] = value
    return base
  }
  base[k] = setIn(base[k], rest, value)
  return base
}

export const newRepository = () => ({ source: '', ref: 'main', project: '', kind: 'api' })

export function addRepository(env, key) {
  return setIn(env, ['repositories', key], newRepository())
}

export function renameRepository(env, from, to) {
  const repositories = Object.fromEntries(Object.entries(env.repositories || {}).map(([k, v]) => [k === from ? to : k, v]))
  let next = { ...env, repositories }
  const swap = v => (v === from ? to : v)
  if (Array.isArray(env.test?.defaultServices)) next = setIn(next, ['test', 'defaultServices'], env.test.defaultServices.map(swap))
  if (Array.isArray(env.test?.wiring)) next = setIn(next, ['test', 'wiring'], env.test.wiring.map(w => (isObj(w) ? { ...w, from: swap(w.from), to: swap(w.to) } : w)))
  // extraDbConn is keyed by repository, so a rename must carry it along or the entry is orphaned
  if (isObj(env.test?.extraDbConn) && from in env.test.extraDbConn) {
    next = setIn(next, ['test', 'extraDbConn'], Object.fromEntries(Object.entries(env.test.extraDbConn).map(([k, v]) => [swap(k), v])))
  }
  // collectionPatterns maps regexes (keys, left alone) to repository keys (values)
  if (isObj(env.test?.collectionPatterns) && Object.values(env.test.collectionPatterns).includes(from)) {
    next = setIn(next, ['test', 'collectionPatterns'], Object.fromEntries(Object.entries(env.test.collectionPatterns).map(([k, v]) => [k, swap(v)])))
  }
  return next
}

export function removeRepository(env, key) {
  let next = setIn(env, ['repositories', key], undefined)
  if (Array.isArray(env.test?.defaultServices)) next = setIn(next, ['test', 'defaultServices'], env.test.defaultServices.filter(s => s !== key))
  return next
}
