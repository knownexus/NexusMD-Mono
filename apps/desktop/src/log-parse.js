// Pure, dependency-free parsing/filtering for the desktop log viewer.
// electron-log writes lines like:
//   [2026-07-01 13:18:08.111] [warn]  [notifications] message
// The [area] tag is optional; entries can span multiple lines (continuation
// lines do not begin with a timestamp header).

export const LOG_LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly']
export const NO_AREA = '(no area)'

const HEADER = new RegExp(
  '^\\[(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3})\\] ' + // [timestamp]
  '\\[(' + LOG_LEVELS.join('|') + ')\\]\\s*' +                     // [level] + padding
  '(?:\\[([^\\]]+)\\]\\s*)?' +                                     // optional [area]
  '(.*)$'                                                          // message
)

export function parseLog(text) {
  if (!text) return []
  const lines = String(text).replace(/\r?\n$/, '').split(/\r?\n/)
  const entries = []
  let cur = null
  let id = 0
  for (const line of lines) {
    const m = HEADER.exec(line)
    if (m) {
      cur = { id: id++, ts: m[1], level: m[2], area: m[3] ?? null, message: m[4] ?? '', extraLines: [] }
      entries.push(cur)
    } else if (cur) {
      cur.extraLines.push(line)
    } else if (line.trim() !== '') {
      // leading text before any header — preserve rather than drop
      cur = { id: id++, ts: '', level: '', area: null, message: line, extraLines: [] }
      entries.push(cur)
    }
  }
  return entries
}

export function filterEntries(entries, { levels, area, search } = {}) {
  const levelSet = levels == null ? null : (levels instanceof Set ? levels : new Set(levels))
  const areaSel = area || null
  const q = (search || '').trim().toLowerCase()
  return (entries || []).filter(e => {
    // Level: unparsed entries (level "") are never hidden by the level filter.
    if (levelSet && e.level !== '' && !levelSet.has(e.level)) return false
    if (areaSel) {
      const eArea = e.area == null ? NO_AREA : e.area
      if (eArea !== areaSel) return false
    }
    if (q) {
      const hay = [e.message, ...(e.extraLines || []), e.area || ''].join('\n').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
