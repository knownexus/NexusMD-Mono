import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { MarkdownViewer, MarkdownDiff } from '../src/index.js'

const HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
const lines = (n, word) => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)
const OLD = ['# Plan', ...lines(10, 'same'), 'old line', ...lines(10, 'tail')].join('\n')
const NEW = ['# Plan', ...lines(10, 'same'), 'new line', ...lines(10, 'tail')].join('\n')

beforeEach(() => {
  const s = document.createElement('script')
  s.src = HLJS
  document.head.appendChild(s)
  window.hljs = { highlightElement: () => {} }
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  document.head.querySelectorAll(`script[src="${HLJS}"]`).forEach(s => s.remove())
  delete window.hljs
})

const rows = () => [...document.querySelectorAll('.m-diff > div')].map(d => (d.classList.contains('gap') ? `gap:${d.textContent}` : `${d.className.replace('ln', '').trim() || 'same'}:${d.textContent}`))

describe('Markdown Compare differences', () => {
  it('Compare shows added/removed counts and collapses unchanged context', async () => {
    localStorage.setItem('md_documents', JSON.stringify({ docs: [
      { id: 'a', name: null, autoName: 'Old plan', content: OLD, createdAt: 1, updatedAt: 1 },
      { id: 'b', name: null, autoName: 'New plan', content: NEW, createdAt: 1, updatedAt: 2 },
    ] }))
    render(<MarkdownViewer/>)
    fireEvent.click(screen.getByText(/^Documents \(/))
    fireEvent.click(screen.getAllByText('New plan').find(el => el.tagName === 'DIV'))
    fireEvent.click(screen.getByRole('button', { name: 'compare' }))
    fireEvent.click(screen.getByRole('button', { name: 'Differences' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Differences' })).toBeTruthy())
    expect(screen.getByText('+1 added')).toBeTruthy()
    expect(screen.getByText('−1 removed')).toBeTruthy()
    const r = rows()
    expect(r).toContain('del:−old line')
    expect(r).toContain('add:+new line')
    // Two lines of context either side; the long unchanged runs fold into a gap.
    expect(r[0]).toBe('gap:⋯ 9 unchanged lines')
    expect(r.at(-1)).toBe('gap:⋯ 8 unchanged lines')
    expect(r).toContain('same: same 10')
    expect(r).not.toContain('same: same 5')
    // Back to the side-by-side preview.
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.queryByRole('region', { name: 'Differences' })).toBeNull()
  })

  it('treats document text as text, never as HTML', () => {
    render(<MarkdownDiff before={'a'} after={'<img src=x onerror="window.__pwned=1">'} otherName="Other"/>)
    expect(document.querySelector('.m-diff img')).toBeNull()
    expect(screen.getByText('<img src=x onerror="window.__pwned=1">')).toBeTruthy()
    expect(window.__pwned).toBeUndefined()
  })

  it('says when there are no differences, and when documents are too long', () => {
    const { rerender } = render(<MarkdownDiff before={'same\ntext'} after={'same\ntext'} otherName="Other"/>)
    expect(screen.getByText('No differences.')).toBeTruthy()
    rerender(<MarkdownDiff before={lines(700, 'x').join('\n')} after={'y'} otherName="Other"/>)
    expect(screen.getByText(/too long to compare/)).toBeTruthy()
  })
})
