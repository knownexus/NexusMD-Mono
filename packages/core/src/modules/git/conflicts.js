// packages/core/src/modules/git/conflicts.js
//
// Merge/rebase conflicts: parse conflict-marker blocks, resolve a region, and word the two sides
// by what they mean (never "ours"/"theirs"). Left is git's stage 2, right is stage 3, in every
// operation. Pure logic only.

const MARK_START = '<<<<<<<'
const MARK_BASE = '|||||||'
const MARK_MID = '======='
const MARK_END = '>>>>>>>'

// A marker line is the 7-char marker, then end of line or a space and a label. `line` has no \r.
function isMarker(line, marker) {
  if (!line.startsWith(marker)) return false
  return line.length === 7 || (line[7] === ' ' && marker !== MARK_MID)
}

function lines(text) {
  const out = []
  let pos = 0
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos)
    const next = nl === -1 ? text.length : nl + 1
    const raw = text.slice(pos, next)
    out.push({ start: pos, end: next, raw, body: raw.replace(/\r?\n$/, '') })
    pos = next
  }
  return out
}

export function parseConflicts(text) {
  const blocks = []
  let cur = null
  for (const ln of lines(String(text ?? ''))) {
    if (!cur) {
      if (isMarker(ln.body, MARK_START)) cur = { start: ln.start, left: '', base: null, right: '', part: 'left' }
      continue
    }
    if (isMarker(ln.body, MARK_START)) {
      cur = { start: ln.start, left: '', base: null, right: '', part: 'left' }
    } else if (cur.part === 'left' && isMarker(ln.body, MARK_BASE)) {
      cur.base = ''
      cur.part = 'base'
    } else if (cur.part !== 'right' && isMarker(ln.body, MARK_MID)) {
      cur.part = 'right'
    } else if (cur.part === 'right' && isMarker(ln.body, MARK_END)) {
      blocks.push({ start: cur.start, end: ln.end, left: cur.left, base: cur.base, right: cur.right })
      cur = null
    } else {
      cur[cur.part] += ln.raw
    }
  }
  return blocks
}

export function resolveRegion(text, index, choice) {
  const block = parseConflicts(text)[index]
  if (!block) return text
  const { left, right } = block
  const body = {
    left, right, leftFirst: left + right, rightFirst: right + left,
  }[choice]
  if (body === undefined) return text
  return text.slice(0, block.start) + body + text.slice(block.end)
}

export function hasMarkers(text) {
  return lines(String(text ?? '')).some((ln) => isMarker(ln.body, MARK_START) || ln.body === MARK_MID || ln.body.startsWith(`${MARK_END} `) || ln.body === MARK_END)
}

const KINDS = {
  UU: 'both-modified',
  AA: 'both-added',
  DU: 'deleted-by-left',
  UD: 'deleted-by-right',
  AU: 'added-by-left',
  UA: 'added-by-right',
  DD: 'both-deleted',
}

export function conflictKind(xy) {
  return KINDS[xy] ?? null
}

const short = (oid) => String(oid ?? '').slice(0, 7)
const shortName = (name) => String(name ?? '').replace(/^refs\/(heads|remotes)\//, '')
const commitText = (c) => `${short(c?.oid)} "${c?.subject ?? ''}"`

const MINE = { take: 'Take mine', version: 'my version' }

// The branch name, or null when it isn't known or HEAD is detached: then the side is "your checkout".
const known = (branch) => (branch && branch !== '(detached)' ? branch : null)

function mineLeft(branch) {
  return { title: known(branch) ? `Your branch (${branch})` : 'Your checkout', ...MINE }
}

export function conflictLabels(op, branch) {
  switch (op?.kind) {
    case 'rebase': {
      const name = shortName(op.onto?.name)
      const left = name
        ? { title: `${name} (already applied)`, take: `Take ${name}'s`, version: `${name}'s version` }
        : { title: `The new base (${short(op.onto?.oid)})`, take: "Take the base's", version: "the base's version" }
      return { left, right: { title: `Your commit ${commitText(op.replaying)}`, ...MINE } }
    }
    case 'merge': {
      const name = shortName(op.merging?.name)
      const right = name
        ? { title: `${name} (being merged)`, take: `Take ${name}'s`, version: `${name}'s version` }
        : { title: `The merged commit (${short(op.merging?.oid)})`, take: 'Take the merged version', version: 'the merged version' }
      return { left: mineLeft(branch), right }
    }
    case 'cherry-pick':
      return {
        left: mineLeft(branch),
        right: { title: `Picked commit ${commitText(op.picked)}`, take: 'Take the picked version', version: 'the picked version' },
      }
    case 'revert':
      return {
        left: mineLeft(branch),
        right: { title: `Reverting ${commitText(op.picked)}`, take: 'Take the reverted version', version: 'the reverted version' },
      }
    default:
      return { left: mineLeft(branch), right: { title: 'The other version', take: 'Take the other version', version: 'the other version' } }
  }
}

export function operationText(op, branch) {
  switch (op?.kind) {
    case 'rebase': {
      const onto = shortName(op.onto?.name) || short(op.onto?.oid)
      const what = known(branch) ? `Rebasing ${branch}` : 'Rebasing'
      const parts = [onto ? `${what} onto ${onto}` : what]
      if (op.step != null && op.total != null) parts.push(`commit ${op.step} of ${op.total}`)
      if (op.replaying) parts.push(commitText(op.replaying))
      return parts.join(' · ')
    }
    case 'merge':
      return `Merging ${shortName(op.merging?.name) || short(op.merging?.oid)} into ${known(branch) ?? 'your checkout'}`
    case 'cherry-pick':
      return `Cherry-picking ${commitText(op.picked)}`
    case 'revert':
      return `Reverting ${commitText(op.picked)}`
    default:
      return ''
  }
}
