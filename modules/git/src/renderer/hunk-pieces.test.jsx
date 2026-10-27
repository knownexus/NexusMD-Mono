import { describe, it, expect } from 'vitest'
import { hunkPieces } from './diff-pane.jsx'

const classOf = (pieces, text) => pieces.find(([t]) => t === text)?.[1] ?? null

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
