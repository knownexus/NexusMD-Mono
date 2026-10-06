// packages/core/src/modules/jira/adf.js — minimal HTML → Atlassian Document Format.
// Covers what mdToHtml and the rich-text editors emit. Unsupported elements are
// reduced to their text rather than rejected. No DOM: core runs headless.

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const MARKS = { strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'underline', s: 'strike', strike: 'strike', del: 'strike', code: 'code' }
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr'])
const LIST_CHILD_TYPES = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock'])

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g
  let m
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1]
    if (m[4] !== undefined) { top.children.push({ text: decode(m[4]) }); continue }
    if (!m[2]) continue // comment
    const tag = m[2].toLowerCase()
    if (m[1] === '/') {
      const idx = stack.map(n => n.tag).lastIndexOf(tag)
      if (idx > 0) stack.length = idx
      continue
    }
    const attrs = {}
    m[3].replace(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, a, b, c) => {
      attrs[k.toLowerCase()] = decode(a ?? b ?? c ?? '')
      return ''
    })
    const node = { tag, attrs, children: [] }
    top.children.push(node)
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(node)
  }
  return root
}

function addMark(marks, mark) {
  if (marks.some(x => x.type === mark.type)) return marks
  if (mark.type === 'code') return [...marks.filter(x => x.type === 'link'), mark]
  if (marks.some(x => x.type === 'code') && mark.type !== 'link') return marks
  return [...marks, mark]
}

function inline(nodes, marks = []) {
  const out = []
  for (const n of nodes) {
    if (n.text !== undefined) {
      const text = n.text.replace(/\s+/g, ' ')
      if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
    } else if (n.tag === 'br') {
      out.push({ type: 'hardBreak' })
    } else if (MARKS[n.tag]) {
      out.push(...inline(n.children, addMark(marks, { type: MARKS[n.tag] })))
    } else if (n.tag === 'a' && n.attrs.href) {
      out.push(...inline(n.children, addMark(marks, { type: 'link', attrs: { href: n.attrs.href } })))
    } else {
      out.push(...inline(n.children, marks))
    }
  }
  return out
}

// Trim leading/trailing whitespace of a block's inline run and drop empties.
function tidy(content) {
  const out = content.map(n => ({ ...n }))
  const first = out.find(n => n.type === 'text')
  if (first && out[0] === first) first.text = first.text.replace(/^\s+/, '')
  const last = [...out].reverse().find(n => n.type === 'text')
  if (last && out[out.length - 1] === last) last.text = last.text.replace(/\s+$/, '')
  return out.filter(n => n.type !== 'text' || n.text)
}

function textOf(n) {
  if (n.text !== undefined) return n.text
  if (n.tag === 'br') return '\n'
  return n.children.map(textOf).join('')
}

const paragraph = (content) => (content.length ? [{ type: 'paragraph', content }] : [])

function list(n) {
  const items = n.children.filter(c => c.tag === 'li').map(li => {
    const content = blocks(li.children).filter(b => LIST_CHILD_TYPES.has(b.type))
    return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] }
  })
  return items.length ? { type: n.tag === 'ol' ? 'orderedList' : 'bulletList', content: items } : null
}

function block(n) {
  switch (n.tag) {
    case 'p': return paragraph(tidy(inline(n.children)))
    case 'div': return blocks(n.children)
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const content = tidy(inline(n.children))
      return content.length ? [{ type: 'heading', attrs: { level: Number(n.tag[1]) }, content }] : []
    }
    case 'ul': case 'ol': { const l = list(n); return l ? [l] : [] }
    case 'li': { const l = list({ tag: 'ul', children: [n] }); return l ? [l] : [] }
    case 'pre': {
      const text = textOf(n).replace(/^\n/, '')
      return [text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' }]
    }
    case 'blockquote': {
      const inner = blocks(n.children).filter(b => LIST_CHILD_TYPES.has(b.type))
      return inner.length ? [{ type: 'blockquote', content: inner }] : []
    }
    case 'hr': return [{ type: 'rule' }]
    default: return paragraph(tidy(inline([{ text: textOf(n) }])))
  }
}

function blocks(nodes) {
  const out = []
  let pending = []
  const flush = () => { out.push(...paragraph(tidy(inline(pending)))); pending = [] }
  for (const n of nodes) {
    if (n.text !== undefined || !BLOCK.has(n.tag)) { pending.push(n); continue }
    flush()
    out.push(...block(n))
  }
  flush()
  return out
}

function plainTextToAdf(text) {
  const content = text.split(/\n{2,}/).map(par => par.trim()).filter(Boolean).map(par => {
    const parts = []
    par.split('\n').forEach((line, i) => {
      if (i > 0) parts.push({ type: 'hardBreak' })
      if (line) parts.push({ type: 'text', text: line })
    })
    return { type: 'paragraph', content: parts }
  })
  return { type: 'doc', version: 1, content }
}

export function htmlToAdf(html) {
  const s = String(html ?? '')
  if (!/<[a-z!/]/i.test(s)) return plainTextToAdf(s)
  return { type: 'doc', version: 1, content: blocks(parse(s).children) }
}
