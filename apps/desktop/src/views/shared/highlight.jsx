// Syntax colours for code shown outside the editor (diffs, conflict sides). Pieces carry the
// `tok-*` classes of @lezer/highlight's classHighlighter, which the editor uses too, and
// devenv-git.css colours them from the theme.
import React from 'react'
import { highlightTree, classHighlighter } from '@lezer/highlight'
import { parserFor } from './languages.js'

// Past this, parsing costs more than the colours are worth.
const MAX_CHARS = 256 * 1024

/**
 * `text`'s lines, each a list of [text, className | null] pieces coloured as `language`, or
 * uncoloured for an unknown language, too much text, or a parse that fails.
 */
export function highlightLines(text, language) {
  const src = String(text ?? '')
  const lines = src.split('\n')
  const parser = language && src.length <= MAX_CHARS ? parserFor(language) : null
  if (!parser) return lines.map(l => [[l, null]])
  const marks = []
  try {
    highlightTree(parser.parse(src), classHighlighter, (from, to, cls) => marks.push([from, to, cls]))
  } catch {
    return lines.map(l => [[l, null]])
  }
  const out = []
  let start = 0
  let m = 0
  for (const line of lines) {
    const end = start + line.length
    const pieces = []
    let pos = start
    while (m < marks.length && marks[m][1] <= start) m++
    for (let k = m; k < marks.length && marks[k][0] < end; k++) {
      const s = Math.max(marks[k][0], pos)
      const e = Math.min(marks[k][1], end)
      if (s > pos) pieces.push([src.slice(pos, s), null])
      if (e > s) { pieces.push([src.slice(s, e), marks[k][2]]); pos = e }
    }
    if (pos < end || !pieces.length) pieces.push([src.slice(pos, end), null])
    out.push(pieces)
    start = end + 1
  }
  return out
}

const TOKEN = /\w+|\s+|[^\w\s]/g

/**
 * The part of `before` and of `after` that differs, as character ranges, for marking the words
 * changed within a pair of removed and added lines: what's left once the common start and end
 * (whole words) are set aside. Null when the lines share nothing, so the whole line counts.
 */
export function changedRange(before, after) {
  const a = before.match(TOKEN) ?? []
  const b = after.match(TOKEN) ?? []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  if (!head && !tail) return null
  const len = toks => toks.join('').length
  return {
    before: [len(a.slice(0, head)), before.length - len(a.slice(a.length - tail))],
    after: [len(b.slice(0, head)), after.length - len(b.slice(b.length - tail))],
  }
}

/** `pieces` with [from, to) also carrying `cls`, splitting the pieces it crosses. */
export function markRange(pieces, [from, to], cls) {
  if (from >= to) return pieces
  const out = []
  let pos = 0
  for (const [text, c] of pieces) {
    const end = pos + text.length
    const cuts = [pos, Math.min(Math.max(from, pos), end), Math.min(Math.max(to, pos), end), end]
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] <= cuts[i]) continue
      const part = text.slice(cuts[i] - pos, cuts[i + 1] - pos)
      out.push([part, i === 1 ? [c, cls].filter(Boolean).join(' ') : c])
    }
    pos = end
  }
  return out
}

/** A list of [text, className] pieces as spans. */
export function Pieces({ pieces }) {
  return pieces.map(([text, cls], i) => (cls ? <span key={i} className={cls}>{text}</span> : text))
}

/**
 * Read-only code with syntax colours and line numbers. Lines whose index is in `marked` are tinted
 * (the lines a conflict side has that the other side doesn't). Each line keeps its newline, so
 * copying the block copies the code.
 */
export function CodeBlock({ text, language, marked = null, start = 1 }) {
  const lines = React.useMemo(() => highlightLines(text, language), [text, language])
  return (
    <pre className="nx-code">
      {lines.map((pieces, i) => (
        <span key={i} className={marked?.has(i) ? 'nx-code-line nx-code-marked' : 'nx-code-line'}>
          <span className="nx-code-no" aria-hidden="true">{start + i}</span>
          <Pieces pieces={pieces} />
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </pre>
  )
}

/** The indexes of `text`'s lines that `other` doesn't have anywhere: what one side adds over the other. */
export function linesNotIn(text, other) {
  const theirs = new Set(String(other ?? '').split('\n').map(l => l.trim()))
  const out = new Set()
  String(text ?? '').split('\n').forEach((l, i) => { if (l.trim() && !theirs.has(l.trim())) out.add(i) })
  return out
}
