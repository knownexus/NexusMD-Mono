// packages/core/src/modules/git/file-filter.js
//
// Go to file: fuzzy-filters a worktree's file list.

// The shortest window of `s` that holds `q` as a subsequence (both lower case), or -1 when there is none.
function span(s, q) {
  let best = -1
  for (let start = s.indexOf(q[0]); start >= 0; start = s.indexOf(q[0], start + 1)) {
    let j = 1
    let i = start + 1
    for (; i < s.length && j < q.length; i++) if (s.charCodeAt(i) === q.charCodeAt(j)) j++
    if (j < q.length) break // later starts have even less text left
    const len = i - start
    if (best < 0 || len < best) best = len
    if (best === q.length) break
  }
  return q.length === 1 ? (s.includes(q) ? 1 : -1) : best
}

/**
 * The files whose path contains `query` as a case-insensitive subsequence, best first: those whose
 * basename contains the query as a substring, then the shorter matched span, the shorter path, then
 * alphabetical. An empty query gives the first `limit` files.
 */
export function filterFiles(files, query, limit = 50) {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return files.slice(0, limit)
  const hits = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const s = span(lower, q)
    if (s < 0) continue
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    hits.push({ path, s, base: base.includes(q) ? 0 : 1 })
  }
  hits.sort((a, b) => a.base - b.base || a.s - b.s || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return hits.slice(0, limit).map(h => h.path)
}
