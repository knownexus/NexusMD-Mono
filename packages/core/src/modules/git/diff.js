// Unified diff parsing for the Git Workspace diff viewer. Ported from gws DiffView.Parse:
// one entry per file section, hunks with old/new line numbers, combined (conflict) diffs read-only.
// Hunks are numbered by their order within a file; main's hunk splitter counts the same way.

const HUNK = /^(@@+) -(\d+)(?:,\d+)? (?:-\d+(?:,\d+)? )*\+(\d+)(?:,\d+)? @@+/
const ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }

// git quotes unusual paths C-style, with non-ASCII bytes as octal escapes of their UTF-8 bytes.
function unquote(s) {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s
  const body = s.slice(1, -1)
  const bytes = []
  const encoder = new TextEncoder()
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) {
      const next = body[i + 1]
      if (/[0-7]/.test(next)) { bytes.push(parseInt(body.slice(i + 1, i + 4), 8)); i += 3; continue }
      if (next in ESCAPES) { bytes.push(ESCAPES[next]); i++; continue }
    }
    const cp = body.codePointAt(i)
    if (cp > 0xffff) i++
    bytes.push(...encoder.encode(String.fromCodePoint(cp)))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// git appends a tab to ---/+++ names containing spaces.
function sidePath(raw, prefix) {
  const p = unquote(raw.replace(/\t$/, ''))
  if (p === '/dev/null') return null
  return p.startsWith(prefix) ? p.slice(prefix.length) : p
}

function closingQuote(s) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '"') return i
  }
  return -1
}

// "diff --git a/X b/Y": the only place a mode-only change names its file.
function gitLinePaths(rest) {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest)
    if (end < 0) return [null, null]
    return [sidePath(rest.slice(0, end + 1), 'a/'), sidePath(rest.slice(end + 2), 'b/')]
  }
  if ((rest.length - 5) % 2 === 0) {
    const p = rest.slice(2, 2 + (rest.length - 5) / 2)
    if (rest === `a/${p} b/${p}`) return [p, p]
  }
  const i = rest.indexOf(' b/')
  return i < 0 ? [null, null] : [rest.slice(2, i), rest.slice(i + 3)]
}

function newFile() {
  return { oldPath: null, newPath: null, path: '', status: 'modified', binary: false, combined: false, meta: [], hunks: [] }
}

function readHeader(file, line) {
  if (line.startsWith('new file mode')) file.status = 'added'
  else if (line.startsWith('deleted file mode')) file.status = 'deleted'
  else if (line.startsWith('rename from ')) { file.oldPath = unquote(line.slice(12)); file.status = 'renamed' }
  else if (line.startsWith('rename to ')) file.newPath = unquote(line.slice(10))
  else if (line.startsWith('copy from ')) { file.oldPath = unquote(line.slice(10)); file.status = 'copied' }
  else if (line.startsWith('copy to ')) file.newPath = unquote(line.slice(8))
  else if (line.startsWith('--- ')) {
    if (file.status !== 'renamed' && file.status !== 'copied') file.oldPath = sidePath(line.slice(4), 'a/')
    if (file.oldPath === null && file.status === 'modified') file.status = 'added'
  } else if (line.startsWith('+++ ')) {
    if (file.status !== 'renamed' && file.status !== 'copied') file.newPath = sidePath(line.slice(4), 'b/')
    if (file.newPath === null) file.status = 'deleted'
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true
  else if (line.startsWith('index ') || line.startsWith('similarity index') || line.startsWith('dissimilarity index')) { /* not shown */ }
  else file.meta.push(line)
}

function readLine(file, hunk, line, counters) {
  if (line.startsWith('\\')) {
    hunk.lines.push({ kind: 'meta', text: line.replace(/^\\\s*/, ''), oldNo: null, newNo: null })
    return
  }
  if (file.combined) {
    // One marker column per parent; only the result's line numbers mean anything.
    const marks = line.slice(0, hunk.columns)
    const text = line.slice(hunk.columns)
    if (marks.includes('-')) hunk.lines.push({ kind: 'del', text, oldNo: null, newNo: null })
    else hunk.lines.push({ kind: marks.includes('+') ? 'add' : 'context', text, oldNo: null, newNo: counters.newNo++ })
    return
  }
  const mark = line[0] ?? ' '
  const text = line.slice(1)
  if (mark === '+') hunk.lines.push({ kind: 'add', text, oldNo: null, newNo: counters.newNo++ })
  else if (mark === '-') hunk.lines.push({ kind: 'del', text, oldNo: counters.oldNo++, newNo: null })
  else if (mark === ' ') hunk.lines.push({ kind: 'context', text, oldNo: counters.oldNo++, newNo: counters.newNo++ })
  else hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
}

/** Parses `git diff` output (or main's synthetic untracked diff) into files, hunks and numbered lines. */
export function parseDiff(text) {
  const files = []
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (!source) return { files }
  let file = null
  let hunk = null
  const counters = { oldNo: 0, newNo: 0 }
  for (const line of source.split('\n')) {
    if (line.startsWith('diff --')) {
      file = newFile()
      files.push(file)
      hunk = null
      const combined = /^diff --(cc|combined) /.exec(line)
      if (combined) { file.combined = true; file.oldPath = file.newPath = unquote(line.slice(combined[0].length)) }
      else [file.oldPath, file.newPath] = gitLinePaths(line.slice(11))
      continue
    }
    if (!file) { file = newFile(); files.push(file) }
    const m = HUNK.exec(line)
    if (m && (hunk === null || line.startsWith('@@'))) {
      hunk = { header: line, oldStart: Number(m[2]), newStart: Number(m[3]), columns: m[1].length - 1, lines: [] }
      file.hunks.push(hunk)
      counters.oldNo = hunk.oldStart
      counters.newNo = hunk.newStart
      continue
    }
    if (hunk === null) readHeader(file, line)
    else readLine(file, hunk, line, counters)
  }
  for (const f of files) f.path = f.newPath ?? f.oldPath ?? ''
  return { files }
}

const SIDES = {
  unstaged: { old: 'index', new: 'working tree', staging: 'stage' },
  staged: { old: 'HEAD', new: 'index', staging: 'unstage' },
  untracked: { old: null, new: 'new file', staging: null },
  conflict: { old: 'ours', new: 'theirs', staging: null },
}

/** What the old and new sides of a change's diff are, and which hunk action applies. */
export function diffSides(change) {
  const s = SIDES[change?.area]
  return s ? { ...s } : null
}
