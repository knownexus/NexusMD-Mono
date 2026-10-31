import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { DocumentsPhone } from './documents-phone.jsx'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

const seed = (docs) => localStorage.setItem('md_documents', JSON.stringify({ docs }))

describe('Markdown cheat sheet', () => {
  it('lists the syntax and inserts the one you tap into the document', async () => {
    render(<DocumentsPhone/>)
    fireEvent.click(screen.getByRole('button', { name: 'Cheat sheet' }))
    expect(screen.getByText('Markdown cheat sheet')).toBeTruthy()
    expect(screen.getByText('Strikethrough')).toBeTruthy()
    fireEvent.click(screen.getByText('Heading 2'))
    await waitFor(() => expect(screen.getByLabelText('Markdown').value).toBe('\n## Heading 2'))
  })
})

describe('Markdown compare', () => {
  it('shows what changed against another saved document, and says when there is nothing to compare', async () => {
    seed([
      { id: 'a', autoName: 'Draft', content: 'one\ntwo\nthree', updatedAt: 1 },
      { id: 'b', autoName: 'Final', content: 'one\nTWO\nthree\nfour', updatedAt: 2 },
    ])
    render(<DocumentsPhone/>)                       // opens the most recent: Final
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(await screen.findByLabelText('Compared with')).toBeTruthy()
    expect(screen.getByText(/\+2 added/)).toBeTruthy()
    expect(screen.getByText(/−1 removed/)).toBeTruthy()
    const lines = [...document.querySelectorAll('.m-diff .ln')].map(l => l.className.replace('ln', '').trim() + ':' + l.textContent.trim())
    expect(lines).toContain('del:−two')
    expect(lines).toContain('add:+TWO')
  })

  it('asks for a second document when there is only one', () => {
    seed([{ id: 'a', autoName: 'Only', content: 'x', updatedAt: 1 }])
    render(<DocumentsPhone/>)
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByText(/Save another document/)).toBeTruthy()
  })
})

describe('Markdown learn mode', () => {
  it('names what you tap in the preview, and remembers the setting', async () => {
    seed([{ id: 'a', autoName: 'Notes', content: '# Big title\n\nsome **bold** text', updatedAt: 1 }])
    render(<DocumentsPhone/>)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Learn mode' }))
    expect(localStorage.getItem('md_learn_mode')).toBe('true')
    await waitFor(() => expect(document.querySelector('.md-content h1')).toBeTruthy())
    fireEvent.click(document.querySelector('.md-content h1'))
    expect(screen.getByRole('status').textContent).toMatch(/Heading 1/)
    expect(screen.getByRole('status').textContent).toMatch(/# Heading/)
    fireEvent.click(document.querySelector('.md-content strong'))
    expect(screen.getByRole('status').textContent).toMatch(/Bold/)
  })

  it('does nothing when you tap the preview with learn mode off', async () => {
    seed([{ id: 'a', autoName: 'Notes', content: '# Title', updatedAt: 1 }])
    render(<DocumentsPhone/>)
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(document.querySelector('.md-content h1')).toBeTruthy())
    fireEvent.click(document.querySelector('.md-content h1'))
    expect(document.querySelector('.m-learn')).toBeNull()
  })
})
