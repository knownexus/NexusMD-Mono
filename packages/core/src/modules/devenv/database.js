// packages/core/src/modules/devenv/database.js
//
// The Database tab's model: devenv's baselines and SQL scripts, and the argv for each db action.

export const DB_EDITOR_URL = 'http://127.0.0.1:14331'
const BASELINE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/
const SCRIPT = /^[A-Za-z0-9_.-]+$/
const DATABASE = /^[A-Za-z0-9_]+$/
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseBaselines(result) {
  if (!result || result.kind !== 'db-baselines') throw new Error('Not a devenv db-baselines result')
  const baselines = (Array.isArray(result.baselines) ? result.baselines : [])
    .filter(b => b && typeof b.id === 'string' && BASELINE.test(b.id))
    .map(b => ({
      id: b.id, createdUtc: str(b.createdUtc), size: Number.isFinite(b.size) ? b.size : 0, isLatest: b.isLatest === true,
      databases: Array.isArray(b.databases) ? b.databases.filter(d => typeof d === 'string') : [],
      sourceContainer: str(b.sourceContainer), valid: b.valid === true,
    }))
  return { latest: str(result.latest), baselines }
}

export function normaliseSqlScripts(result) {
  if (!result || result.kind !== 'db-scripts') throw new Error('Not a devenv db-scripts result')
  const scripts = (Array.isArray(result.scripts) ? result.scripts : [])
    .filter(s => s && typeof s.id === 'string' && SCRIPT.test(s.id))
    .map(s => ({ id: s.id, about: typeof s.about === 'string' ? s.about : '' }))
  return { database: str(result.database), scripts }
}

const FIXED = { start: ['db', 'start'], stop: ['db', 'stop'], backup: ['db', 'backup'], verify: ['db', 'verify'], ui: ['db', 'ui'], 'ui-off': ['db', 'ui', '--off'] }

export function buildDbArgv(action) {
  const a = action || {}
  if (FIXED[a.kind]) return [...FIXED[a.kind]]
  if (a.kind === 'restore') {
    if (a.baseline == null || a.baseline === '') return ['db', 'restore']
    if (!BASELINE.test(a.baseline)) throw new Error(`Not a baseline id: ${a.baseline}`)
    return ['db', 'restore', '--baseline', a.baseline]
  }
  if (a.kind === 'sql') {
    if (typeof a.script !== 'string' || !SCRIPT.test(a.script) || a.script.startsWith('-')) throw new Error(`Not a script name: ${a.script}`)
    const db = typeof a.database === 'string' ? a.database.trim() : ''
    if (db && !DATABASE.test(db)) throw new Error(`Not a database name: ${db}`)
    return ['db', 'sql', a.script, ...(db ? ['--database', db] : [])]
  }
  throw new Error(`Unknown db action: ${a.kind}`)
}
