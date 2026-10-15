// packages/core/src/modules/git/history.js
//
// The commits browser's model: parsing `git log --graph` (records after a \x1e marker, fields split
// by \x1f, refs from --decorate=full so local and remote branches can't be confused), the search
// syntax, and the query object main validates again before building any argv.

const RS = '\x1e'
const US = '\x1f'
export const HISTORY_STEP = 200
export const HISTORY_MAX = 5000
const FILTERS = ['all', 'unpushed', 'sinceBase']
const SEARCH_KINDS = ['message', 'author', 'path']

export function parseRefs(decoration) {
  if (!decoration) return []
  return decoration.split(', ').filter(Boolean).flatMap(part => {
    if (part === 'HEAD') return [{ kind: 'head', name: 'HEAD' }]
    if (part.startsWith('HEAD -> ')) return [{ kind: 'head', name: 'HEAD' }, ...parseRefs(part.slice(8))]
    if (part.startsWith('tag: refs/tags/')) return [{ kind: 'tag', name: part.slice(15) }]
    if (part.startsWith('refs/heads/')) return [{ kind: 'branch', name: part.slice(11) }]
    if (part.startsWith('refs/remotes/')) return [{ kind: 'remote', name: part.slice(13) }]
    if (part.startsWith('refs/tags/')) return [{ kind: 'tag', name: part.slice(10) }]
    return [{ kind: 'other', name: part }]
  })
}

/** Parses `git log --graph --decorate=full --format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s`. */
export function parseLog(text) {
  const rows = []
  for (const line of String(text ?? '').split('\n')) {
    if (line === '') continue
    const at = line.indexOf(RS)
    if (at < 0) { rows.push({ graph: line.replace(/\s+$/, ''), commit: null }); continue }
    const f = line.slice(at + 1).split(US)
    if (f.length < 7) continue
    const [oid, parents, author, email, time, decoration, ...subject] = f
    rows.push({
      graph: line.slice(0, at).replace(/\s+$/, ''),
      commit: {
        oid, parents: parents ? parents.split(' ') : [], author, email, time: Number(time) * 1000,
        refs: parseRefs(decoration), subject: subject.join(US),
      },
    })
  }
  return rows
}

// git draws two columns per lane.
const GLYPH = { '*': '●', '|': '│', '/': '╱', '\\': '╲', '-': '─', '.': '·' }
export function graphCells(graph) {
  return [...String(graph ?? '')].map((ch, i) => ({ ch: GLYPH[ch] ?? ch, lane: Math.floor(i / 2) }))
}

export function parseSearch(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  let kind = 'message'
  let text = s
  if (s.startsWith('\\@') || s.startsWith('\\:')) text = s.slice(1)
  else if (s[0] === '@') { kind = 'author'; text = s.slice(1).trim() }
  else if (s[0] === ':') { kind = 'path'; text = s.slice(1).trim() }
  if (!text) throw new Error(kind === 'author' ? 'Type a name after @' : 'Type a path after :')
  return checkSearch({ kind, text })
}

function checkSearch(search) {
  if (!search || !SEARCH_KINDS.includes(search.kind) || typeof search.text !== 'string' || !search.text) throw new Error('Unknown search')
  const { text } = search
  if (text.length > 200) throw new Error('Search is limited to 200 characters')
  if (/[\0\r\n]/.test(text)) throw new Error('Search must be one line')
  if (search.kind === 'path') {
    const parts = text.split(/[\\/]/)
    if (/^[A-Za-z]:/.test(text) || /^[\\/]/.test(text) || parts.some(p => p === '..')) throw new Error('Search paths must be inside the worktree')
  }
  return { kind: search.kind, text }
}

const isRef = (v, prefixes) => typeof v === 'string' && prefixes.some(p => v.startsWith(p) && v.length > p.length)

/**
 * The query main's `log` takes. Main checks it again against refs it reads itself.
 * @param {{ ref: string, filter?: string, base?: string|null, search?: object|null, limit?: number }} q
 */
export function historyQuery({ ref, filter = 'all', base = null, search = null, limit = HISTORY_STEP } = {}) {
  if (ref !== 'HEAD' && !isRef(ref, ['refs/heads/'])) throw new Error('Choose a branch')
  if (!FILTERS.includes(filter)) throw new Error(`Unknown filter: ${filter}`)
  if (filter === 'sinceBase' && !isRef(base, ['refs/heads/', 'refs/remotes/'])) throw new Error('Pick a base to compare with')
  if (!Number.isInteger(limit) || limit < HISTORY_STEP || limit > HISTORY_MAX || limit % HISTORY_STEP) throw new Error('Unsupported page size')
  return { ref, filter, base: filter === 'sinceBase' ? base : null, search: search ? checkSearch(search) : null, limit }
}

/** Parses the `refs` read: `%(refname)%00%(objectname)%00%(upstream)%00%(HEAD)` lines. */
export function parseRefList(raw) {
  return String(raw ?? '').split('\n').filter(Boolean).map(line => {
    const [ref, oid, upstream, head] = line.split('\0')
    return { ref, oid, upstream: upstream || null, head: head === '*' }
  })
}

/** The "since base" default: origin's HEAD, then main, then master; never the ref itself. */
export function defaultBase(refs, { ref, originHead = null } = {}) {
  const have = new Set((refs || []).map(r => r.ref))
  const self = ref === 'HEAD' ? (refs || []).find(r => r.head)?.ref : ref
  for (const candidate of [originHead, 'refs/heads/main', 'refs/heads/master']) {
    if (candidate && have.has(candidate) && candidate !== self) return candidate
  }
  return null
}

/** Parses `show -s --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B`. */
export function parseCommitDetails(raw) {
  const f = String(raw ?? '').split('\0')
  const [oid = '', parents = '', author = '', authorEmail = '', authorDate = '', committer = '', committerEmail = '', committerDate = '', decoration = '', ...message] = f
  return {
    oid: oid.trim(), parents: parents ? parents.split(' ') : [], author, authorEmail, authorDate, committer, committerEmail, committerDate,
    refs: parseRefs(decoration), message: message.join('\0').replace(/\n+$/, ''),
  }
}

/** Parses `diff-tree -z --name-status` records; renames and copies carry two paths. */
export function parseNameStatus(raw) {
  const f = String(raw ?? '').split('\0')
  const out = []
  for (let i = 0; i < f.length; i++) {
    const code = f[i]
    if (!code) continue
    const status = code[0]
    const score = code.length > 1 ? Number(code.slice(1)) : null
    if (status === 'R' || status === 'C') {
      out.push({ status, score, oldPath: f[i + 1], path: f[i + 2] })
      i += 2
    } else {
      out.push({ status, score, oldPath: null, path: f[i + 1] })
      i += 1
    }
  }
  return out.filter(e => typeof e.path === 'string')
}

// An octopus has no single "merged in" parent, so only its first parent gets a name.
export function parentLabel(details, index) {
  const oid = details?.parents?.[index]
  if (!oid) return ''
  const name = index === 0 ? ' (main line)' : index === 1 && details.parents.length === 2 ? ' (merged in)' : ''
  return `${index + 1}${name} · ${oid.slice(0, 7)}`
}
