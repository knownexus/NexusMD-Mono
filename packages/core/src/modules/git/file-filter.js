// packages/core/src/modules/git/file-filter.js
//
// Go to file: fuzzy-filters a worktree's file list.

// The shortest span of `q` as a subsequence of `s` (both lower case), or -1 when it isn't one.
function span(s, q) {
  let j = 0
  let end = -1
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s.charCodeAt(i) === q.charCodeAt(j)) { j++; end = i }
  }
  if (j < q.length) return -1
  // Walk back from the end to the latest start that still fits.
  let start = end
  j = q.length - 1
  for (let i = end; i >= 0 && j >= 0; i--) {
    if (s.charCodeAt(i) === q.charCodeAt(j)) { j--; start = i }
  }
  return end - start + 1
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
