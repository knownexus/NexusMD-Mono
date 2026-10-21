// packages/core/src/modules/git/word-match.js
//
// Filters by the start of words: every typed term must begin a word, where a word starts at the
// beginning of the text or right after any character that isn't a letter or digit (space - _ / . …).
// "qr" finds "fix/qrcode-response" and "Free Pass"; "code" does not find "qrcode".

const SPECIAL = /[.*+?^${}()|[\]\\]/g

function terms(query) {
  return String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function startsAWord(text, term) {
  return new RegExp(`(^|[^a-z0-9])${term.replace(SPECIAL, '\\$&')}`).test(text)
}

/** True when every whitespace-separated term in `query` starts a word in `text`. An empty query matches. */
export function wordMatch(text, query) {
  const t = terms(query)
  if (!t.length) return true
  const s = String(text ?? '').toLowerCase()
  return t.every(term => startsAWord(s, term))
}

/** The items whose `toText(item)` word-matches `query`, in their original order. */
export function filterByWords(items, query, toText = String) {
  if (!terms(query).length) return items
  return items.filter(item => wordMatch(toText(item), query))
}

/**
 * Go to file, by word starts: paths where every term starts a word, best first — the basename matching
 * every term, then shorter paths, then alphabetical. An empty query gives the first `limit` files.
 */
export function filterFilesByWords(files, query, limit = 50) {
  const t = terms(query)
  if (!t.length) return files.slice(0, limit)
  const hits = []
  for (const path of files) {
    const lower = path.toLowerCase()
    if (!t.every(term => startsAWord(lower, term))) continue
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    hits.push({ path, base: t.every(term => startsAWord(base, term)) ? 0 : 1 })
  }
  hits.sort((a, b) => a.base - b.base || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return hits.slice(0, limit).map(h => h.path)
}
