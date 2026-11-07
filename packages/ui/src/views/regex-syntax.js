// regex-syntax.js — pure, DOM-free helpers behind the Regex Tester's colouring, error line, insert-at-caret,
// replace preview and match stepping. No React and no browser globals, so each is unit-testable.

const QUANT = /^\{\d+(,\d*)?\}/
// Extra characters an escape takes: \xHH, \uHHHH, \u{…}, \p{…}, \P{…}, \k<…>, \cX.
const ESCAPE_TAIL = [/^x[0-9a-fA-F]{2}/, /^u\{[0-9a-fA-F]+\}/, /^u[0-9a-fA-F]{4}/, /^[pP]\{[^}]*\}/, /^k<[^>]*>/, /^c[A-Za-z]/]
// What opens a group without capturing: (?: (?= (?! (?<= (?<!
const NON_CAPTURING = /^\(\?(?::|=|!|<=|<!)/
const NAMED = /^\(\?<[A-Za-z_$][\w$]*>/

/**
 * The pattern as coloured parts: [{ text, kind, group? }] with kind escape | class | quant | group-open |
 * group-close | literal | unclosed. A capture group's parentheses carry its 1-based `group` number (counted as
 * the engine counts: by where it opens; lookaround and (?:…) have none, a named group is numbered). The ( of a
 * group that is never closed is `unclosed`. Never throws, and the texts joined are the pattern.
 */
export function tokenizePattern(pattern) {
  const tokens = []
  const stack = []
  let captures = 0
  const s = String(pattern ?? '')
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i)
    const ch = s[i]
    if (ch === '\\') {
      const tail = ESCAPE_TAIL.map(re => re.exec(rest.slice(1))).find(Boolean)
      const text = tail ? `\\${tail[0]}` : rest.slice(0, 2)
      tokens.push({ text, kind: 'escape' })
      i += text.length
    } else if (ch === '[') {
      let j = i + 1
      while (j < s.length && s[j] !== ']') j += s[j] === '\\' ? 2 : 1
      const end = Math.min(j + 1, s.length)
      tokens.push({ text: s.slice(i, end), kind: 'class' })
      i = end
    } else if (ch === '(') {
      const named = NAMED.exec(rest)
      const plain = !NON_CAPTURING.test(rest) && !rest.startsWith('(?')
      const text = named ? named[0] : NON_CAPTURING.test(rest) ? NON_CAPTURING.exec(rest)[0] : '('
      const group = named || plain ? ++captures : undefined
      const token = { text, kind: 'group-open', ...(group ? { group } : null) }
      tokens.push(token)
      stack.push({ token, group })
      i += text.length
    } else if (ch === ')') {
      const open = stack.pop()
      tokens.push({ text: ')', kind: 'group-close', ...(open?.group ? { group: open.group } : null) })
      i += 1
    } else if (ch === '+' || ch === '*' || ch === '?' || (ch === '{' && QUANT.test(rest))) {
      const body = ch === '{' ? QUANT.exec(rest)[0] : ch
      const lazy = rest[body.length] === '?' ? '?' : ''
      tokens.push({ text: body + lazy, kind: 'quant' })
      i += body.length + lazy.length
    } else {
      tokens.push({ text: ch, kind: 'literal' })
      i += 1
    }
  }
  for (const { token } of stack) token.kind = 'unclosed'
  return tokens
}

const COLUMN_OF = {
  'Unterminated group': { find: tokens => tokens.find(t => t.kind === 'unclosed'), hint: 'Add a closing ) or remove the (.' },
  "Unmatched ')'": { find: tokens => unmatchedClose(tokens), hint: 'Remove the ) or add a matching (.' },
  'Unterminated character class': { find: tokens => tokens.find(t => t.kind === 'class' && !/\]$/.test(t.text.replace(/\\\]/g, '')) ), hint: 'Add a closing ].' },
  'Nothing to repeat': { find: tokens => loneQuantifier(tokens), hint: 'Put something before the + * ? or { } to repeat.' },
}

function unmatchedClose(tokens) {
  let depth = 0
  for (const t of tokens) {
    if (t.kind === 'group-open' || t.kind === 'unclosed') depth++
    else if (t.kind === 'group-close') { if (!depth) return t; depth-- }
  }
  return null
}

function loneQuantifier(tokens) {
  let prev = null
  for (const t of tokens) {
    if (t.kind === 'quant' && (!prev || prev.kind === 'group-open' || prev.kind === 'unclosed' || (prev.kind === 'literal' && prev.text === '|') || prev.kind === 'quant')) return t
    prev = t
  }
  return null
}

/**
 * The error line under the pattern: the engine's reason without its "/pattern/" prefix, the 1-based column of
 * the character at fault where it can be worked out, and a plain hint for the common mistakes; null column and
 * hint for anything else.
 */
export function regexErrorInfo(message, pattern) {
  const text = String(message ?? '')
  const reason = (/^Invalid regular expression: \/[\s\S]*\/[a-z]*: ([\s\S]*)$/.exec(text) ?? [])[1] ?? text
  const known = Object.entries(COLUMN_OF).find(([key]) => reason.startsWith(key))?.[1]
  if (!known) return { message: reason, column: null, hint: null }
  const tokens = tokenizePattern(pattern)
  const at = known.find(tokens)
  const offset = at ? tokens.slice(0, tokens.indexOf(at)).reduce((n, t) => n + t.text.length, 0) : null
  return { message: reason, column: offset == null ? null : offset + 1, hint: known.hint }
}

/** \`token\` put into \`text\` over [start, end) (a caret when equal); the range is clamped. Gives the new text and caret. */
export function insertAt(text, start, end, token) {
  const a = Math.max(0, Math.min(start, end, text.length))
  const b = Math.min(text.length, Math.max(start, end))
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length }
}

// What a replacement template gives for one match, as String.prototype.replace reads it.
function expand(template, m, source) {
  return template.replace(/\$(\$|&|`|'|<([^>]*)>|\d{1,2})/g, (whole, what, name) => {
    if (what === '$') return '$'
    if (what === '&') return m[0]
    if (what === '`') return source.slice(0, m.index)
    if (what === "'") return source.slice(m.index + m[0].length)
    if (name !== undefined) return m.groups && name in m.groups ? m.groups[name] ?? '' : whole
    const n = Number(what)
    if (n >= 1 && n < m.length) return m[n] ?? ''
    if (what.length === 2 && Number(what[0]) >= 1 && Number(what[0]) < m.length) return (m[Number(what[0])] ?? '') + what[1]
    return whole
  })
}

/**
 * What replacing every match of \`re\` (only the first without the g flag) in \`source\` gives, as [{ text,
 * replaced }]: untouched text and the text each match was replaced with, so the result can be drawn with the
 * replaced spans marked. An empty match never loops, and joined the texts equal source.replace(re, replacement).
 */
export function replaceSegments(source, re, replacement) {
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const out = []
  const push = (text, replaced) => { if (text) out.push({ text, replaced }) }
  let at = 0
  for (const m of source.matchAll(all)) {
    push(source.slice(at, m.index), false)
    const text = expand(replacement, m, source)
    push(text, text !== '')
    at = m.index + m[0].length
    if (!re.flags.includes('g')) break
  }
  push(source.slice(at), false)
  return out
}

/** The next index stepping \`dir\` (1 or -1) from \`current\` (-1 for none) among \`n\` matches, wrapping; -1 when there are none. */
export function stepIndex(current, dir, n) {
  if (n <= 0) return -1
  if (current < 0) return dir > 0 ? 0 : n - 1
  return (current + dir + n) % n
}
