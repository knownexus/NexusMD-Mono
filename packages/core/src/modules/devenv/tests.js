// packages/core/src/modules/devenv/tests.js
//
// The Tests tab's model: devenv's run history and Bruno collection, and the argv for test up /
// test run. Paths in a collection are relative and /-separated, as bru run expects them.

const str = v => (typeof v === 'string' && v ? v : null)
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [])
const count = v => (Number.isFinite(v) ? v : 0)
const KEY = /^[a-z0-9][a-z0-9_-]*$/i

function requests(r) {
  return r && typeof r === 'object' && Number.isFinite(r.total) ? { total: r.total, passed: count(r.passed), failed: count(r.failed) } : null
}

export function normaliseTestRuns(result) {
  if (!result || result.kind !== 'test-runs') throw new Error('Not a devenv test-runs result')
  const runs = (Array.isArray(result.runs) ? result.runs : []).filter(r => r && typeof r === 'object' && str(r.id)).map(r => ({
    id: r.id, label: str(r.label) ?? r.id, at: str(r.at), env: str(r.env), collection: str(r.collection),
    paths: strings(r.paths), services: strings(r.services),
    exit: Number.isInteger(r.exit) ? r.exit : null,
    passed: typeof r.passed === 'boolean' ? r.passed : null,
    requests: requests(r.requests),
    traceHtml: str(r.traceHtml), brunoHtml: str(r.brunoHtml),
  }))
  const reports = (Array.isArray(result.reports) ? result.reports : []).filter(p => p && str(p.path))
    .map(p => ({ name: str(p.name) ?? p.path, at: str(p.at), path: p.path }))
  return { runs, reports }
}

export function normaliseTestCollection(result) {
  if (!result || result.kind !== 'test-collection') throw new Error('Not a devenv test-collection result')
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter(i => i && str(i.path) && (i.kind === 'folder' || i.kind === 'request'))
    .map(i => ({ path: i.path, name: i.path.split('/').pop(), kind: i.kind, depth: Number.isInteger(i.depth) ? i.depth : 0 }))
  return { root: str(result.root), isDefault: result.isDefault === true, error: str(result.error), items }
}

export function buildTestUpArgv({ apis = [], noBuild = false } = {}) {
  for (const a of apis) if (typeof a !== 'string' || !KEY.test(a)) throw new Error(`Not an API key: ${a}`)
  return ['test', 'up', ...apis, ...(noBuild ? ['--no-build'] : [])]
}

// devenv reads anything starting with '-' as an option.
function value(name, v) {
  const t = typeof v === 'string' ? v.trim() : ''
  if (t.startsWith('-')) throw new Error(`${name} can't start with '-': ${t}`)
  return t
}

function relativePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('-') || p.startsWith('/') || p.startsWith('\\') || /^[a-z]:/i.test(p) || p.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a path inside the collection: ${p}`)
  }
  return p
}

export function buildTestRunArgv({ paths = [], collection = '', env = '', tags = '', allApis = false, name = '' } = {}) {
  const col = typeof collection === 'string' ? collection.trim() : ''
  if (col && !/^([a-z]:[\\/]|\\\\)/i.test(col)) throw new Error(`The collection must be a full folder path: ${col}`)
  const e = value('Environment', env), t = value('Tags', tags), n = value('Name', name)
  return [
    'test', 'run', ...paths.map(relativePath),
    ...(col ? ['--collection', col] : []), ...(e ? ['--env', e] : []), ...(t ? ['--tags', t] : []),
    ...(allApis ? ['--all-apis'] : []), ...(n ? ['--name', n] : []),
  ]
}

// A folder runs everything under it, so a request inside a selected folder would run twice.
export function topLevelPaths(paths) {
  return paths.filter(p => !paths.some(q => q !== p && p.startsWith(`${q}/`)))
}
