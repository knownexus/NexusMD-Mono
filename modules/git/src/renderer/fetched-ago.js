// How long ago a fetch (or any ISO time) was, in words: "just now", "2 min ago", "3 h ago", "yesterday", or the date.
export function fetchedAgo(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const m = Math.floor((now - t) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  if (h < 48) return 'yesterday'
  return new Date(t).toLocaleDateString()
}

/** The header's fetch line for a set of worktrees: the oldest fetch counts, since it's what "all" waits on. */
export function allFetchedText(trees, now = Date.now()) {
  const times = trees.filter(t => !t.error && t.upstream).map(t => t.fetchedAt)
  if (!times.length) return null
  if (times.some(t => !t)) return 'Some never fetched'
  const oldest = times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
  return `All fetched ${fetchedAgo(oldest, now)}`
}
