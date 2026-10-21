import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { highlightLines, changedRange, markRange, CodeBlock, linesNotIn } from './highlight.jsx'
import { hunkPieces } from '../git/diff-pane.jsx'

afterEach(cleanup)

const classOf = (pieces, text) => pieces.find(([t]) => t === text)?.[1] ?? null

describe('highlightLines', () => {
  it('colours code by token, keeping every character of every line', () => {
    const src = 'const a = "x" // note\nlet n = 42'
    const [one, two] = highlightLines(src, 'javascript')
    expect(one.map(([t]) => t).join('')).toBe('const a = "x" // note')
    expect(classOf(one, 'const')).toBe('tok-keyword')
    expect(classOf(one, '"x"')).toBe('tok-string')
    expect(classOf(one, '// note')).toBe('tok-comment')
    expect(classOf(two, '42')).toBe('tok-number')
  })

  it('carries a token that spans lines onto each of them', () => {
    const lines = highlightLines('/* one\ntwo */ x', 'javascript')
    expect(lines[0]).toEqual([['/* one', 'tok-comment']])
    expect(lines[1][0]).toEqual(['two */', 'tok-comment'])
  })

  it('leaves plain text, an unknown language and empty lines uncoloured', () => {
    expect(highlightLines('a\n\nb', null)).toEqual([[['a', null]], [['', null]], [['b', null]]])
    expect(highlightLines('a', 'cobol')).toEqual([[['a', null]]])
    expect(highlightLines('x = 1\n\n', 'javascript')[1]).toEqual([['', null]])
  })

  it('colours the legacy-mode languages (PowerShell, C#) too', () => {
    expect(classOf(highlightLines('function f { }', 'powershell')[0], 'function')).toBe('tok-keyword')
    expect(classOf(highlightLines('public class A {}', 'csharp')[0], 'public')).toBe('tok-keyword')
  })
})

describe('changedRange and markRange', () => {
  it('finds the words that changed between two lines', () => {
    expect(changedRange('return a + b;', 'return a - b;')).toEqual({ before: [9, 10], after: [9, 10] })
    expect(changedRange('foo(bar)', 'foo(bar, baz)')).toEqual({ before: [7, 7], after: [7, 12] })
    expect(changedRange('alpha', 'omega')).toBeNull()
  })

  it('marks a range across pieces, splitting where it starts and ends', () => {
    expect(markRange([['ab', 'k'], ['cd', null]], [1, 3], 'w')).toEqual([['a', 'k'], ['b', 'k w'], ['c', 'w'], ['d', null]])
    expect(markRange([['ab', null]], [1, 1], 'w')).toEqual([['ab', null]])
  })
})

describe('hunkPieces', () => {
  it('colours each side as code and marks the words a changed line changed', () => {
    const lines = [
      { kind: 'context', text: 'const total = 1' },
      { kind: 'del', text: 'return a + b' },
      { kind: 'add', text: 'return a - b' },
      { kind: 'add', text: '// added' },
      { kind: 'meta', text: '\\ No newline at end of file' },
    ]
    const pieces = hunkPieces(lines, 'javascript')
    expect(pieces.map(p => p.map(([t]) => t).join(''))).toEqual(lines.map(l => l.text))
    expect(classOf(pieces[0], 'const')).toBe('tok-keyword')
    expect(pieces[1].find(([, c]) => c?.includes('nx-word-del'))?.[0]).toBe('+')
    expect(pieces[2].find(([, c]) => c?.includes('nx-word-add'))?.[0]).toBe('-')
    expect(classOf(pieces[3], '// added')).toBe('tok-comment')
    expect(pieces[4]).toEqual([['\\ No newline at end of file', null]])
  })
})

describe('CodeBlock', () => {
  it('numbers and colours the lines, tints the marked ones, and copies as the code itself', () => {
    const { container } = render(<CodeBlock text={'let a = 1\nlet b = 2'} language="javascript" marked={linesNotIn('let a = 1\nlet b = 2', 'let a = 1')} />)
    const lines = [...container.querySelectorAll('.nx-code-line')]
    expect(lines.map(l => l.querySelector('.nx-code-no').textContent)).toEqual(['1', '2'])
    expect(lines.map(l => l.classList.contains('nx-code-marked'))).toEqual([false, true])
    expect(container.querySelector('.tok-keyword').textContent).toBe('let')
    const code = [...container.querySelectorAll('.nx-code-line')].map(l => [...l.childNodes].filter(n => !n.classList?.contains('nx-code-no')).map(n => n.textContent).join('')).join('')
    expect(code).toBe('let a = 1\nlet b = 2')
  })

  it('marks only the non-blank lines one side has and the other does not', () => {
    expect([...linesNotIn('a\n  b\n\nc', 'b\nx')]).toEqual([0, 3])
  })
})
