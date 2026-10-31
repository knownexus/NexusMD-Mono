import { describe, it, expect } from 'vitest'
import { CHEAT, learnTarget, diffLines, diffCounts, collapseDiff, MAX_DIFF_LINES } from './md-extras.js'
import { FORMATS } from './views/md-phone.jsx'

const html = (markup) => { const root = document.createElement('div'); root.innerHTML = markup; return root }

describe('cheat sheet', () => {
  it('only points at formatting chips that exist', () => {
    const titles = FORMATS.map(f => f.title)
    for (const g of CHEAT) for (const it of g.items) expect(titles).toContain(it.format)
  })
})

describe('learn mode', () => {
  it('names what a tapped element is, walking up from text inside it', () => {
    const root = html('<h2>Title <em>here</em></h2><p>plain</p>')
    expect(learnTarget(root.querySelector('em'), root)).toEqual({ name: 'Italic', syntax: '*text*' })
    expect(learnTarget(root.querySelector('h2'), root)).toEqual({ name: 'Heading 2', syntax: '## Heading' })
    expect(learnTarget(root.querySelector('p'), root)).toBeNull()
  })
  it('tells a code block from inline code', () => {
    const root = html('<pre><code>x = 1</code></pre><p><code>y</code></p>')
    expect(learnTarget(root.querySelector('pre code'), root).name).toBe('Code block')
    expect(learnTarget(root.querySelector('p code'), root).name).toBe('Inline code')
  })
  it('tells tasks and numbered items from bullets', () => {
    const root = html('<ul><li><input type="checkbox"> todo</li><li>plain</li></ul><ol><li>one</li></ol>')
    const [task, plain] = root.querySelectorAll('ul li')
    expect(learnTarget(task, root).name).toBe('Task')
    expect(learnTarget(plain, root).name).toBe('List item')
    expect(learnTarget(root.querySelector('ol li'), root).name).toBe('Numbered list item')
  })
})

describe('compare', () => {
  it('marks added, removed and unchanged lines', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc\nd')
    expect(d.map(x => x.t + x.v)).toEqual(['=a', '-b', '+B', '=c', '+d'])
    expect(diffCounts(d)).toEqual({ added: 2, removed: 1 })
  })
  it('finds nothing to report for identical text', () => {
    expect(diffCounts(diffLines('x\ny', 'x\ny'))).toEqual({ added: 0, removed: 0 })
  })
  it('gives up on text too long to compare on a phone', () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `l${i}`).join('\n')
    expect(diffLines(big, 'x')).toBeNull()
  })
  it('hides long unchanged stretches but keeps context around changes', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const next = old.replace('line10', 'CHANGED')
    const c = collapseDiff(diffLines(old, next), 2)
    expect(c[0]).toEqual({ t: 'gap', v: '8 unchanged lines' })
    expect(c.filter(x => x.t === '-' || x.t === '+').map(x => x.v)).toEqual(['line10', 'CHANGED'])
    expect(c.at(-1)).toEqual({ t: 'gap', v: '7 unchanged lines' })
  })
})
