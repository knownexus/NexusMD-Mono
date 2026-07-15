// history-store.js — local, per-request send history for the api-client
// module. Deliberately kept OUT of collection.json/requests/*.json (which
// are meant to be git-tracked and diff-friendly) — every send would
// otherwise churn the tracked files. Instead each request's history lives
// in its own file under a `.history/` directory that self-excludes from
// git via a generated .gitignore, so no manual git configuration is needed.
//
// Layout:
//   <dir>/.history/.gitignore      "*"  (written once, on first append)
//   <dir>/.history/<refId>.json    array of entries, oldest first, capped

const HISTORY_DIR = '.history'
const MAX_ENTRIES = 50

const join = (...parts) => parts.join('/')

async function ensureGitignore(file, dir) {
  const path = join(dir, HISTORY_DIR, '.gitignore')
  if (!(await file.exists(path))) await file.write(path, '*\n')
}

/** Appends `entry` to refId's history, capping at the most recent MAX_ENTRIES. Returns the resulting list. */
export async function appendHistoryEntry(file, dir, refId, entry) {
  await file.mkdir(join(dir, HISTORY_DIR))
  await ensureGitignore(file, dir)

  const path = join(dir, HISTORY_DIR, `${refId}.json`)
  let existing = []
  try { existing = JSON.parse(await file.read(path)) } catch { existing = [] }

  const next = [...existing, entry].slice(-MAX_ENTRIES)
  await file.write(path, JSON.stringify(next, null, 2))
  return next
}

export async function readHistory(file, dir, refId) {
  try {
    return JSON.parse(await file.read(join(dir, HISTORY_DIR, `${refId}.json`)))
  } catch {
    return []
  }
}

export async function clearHistory(file, dir, refId) {
  try { await file.delete(join(dir, HISTORY_DIR, `${refId}.json`)) } catch { /* nothing to clear */ }
}
