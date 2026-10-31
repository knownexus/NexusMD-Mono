import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { DocumentsPhone } from './documents-phone.jsx'
import { applyFormat, autoNameOf, wordCount, FORMATS } from './md-phone.jsx'
import { jsonAutoName, parseJson, patternError, regexAutoName, flagsToString } from './json-regex-phone.jsx'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('markdown helpers', () => {
  it('wraps the selection, or a placeholder when nothing is selected', () => {
    const bold = FORMATS.find(f => f.title === 'Bold')
    expect(applyFormat('hello world', 0, 5, bold)).toEqual({ next: '**hello** world', from: 2, to: 7 })
    expect(applyFormat('', 0, 0, bold)).toEqual({ next: '**bold text**', from: 2, to: 11 })
  })
  it('names a document by its first heading and counts words', () => {
    expect(autoNameOf('# Release notes\n\nbody')).toBe('Release notes')
    expect(autoNameOf('no heading')).toBe('Untitled')
    expect(wordCount('')).toBe(0)
    expect(wordCount('one two  three')).toBe(3)
  })
})

describe('json and regex helpers', () => {
  it('parses JSON and reports the error text', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    const bad = parseJson('{"a":')
    expect(bad.ok).toBe(false)
    expect(bad.message).toBeTruthy()
  })
  it('names a JSON document by its name or title field', () => {
    expect(jsonAutoName('{"name":"Cfg"}')).toBe('Cfg')
    expect(jsonAutoName('{"title":"T"}')).toBe('T')
    expect(jsonAutoName('[1,2]')).toBe('[1,2]')
    expect(jsonAutoName('  ')).toBe('Untitled')
  })
  it('explains a bad pattern without the engine noise', () => {
    expect(patternError('', 'g')).toBe('')
    expect(patternError('\d+', 'g')).toBe('')
    const msg = patternError('(unclosed', 'g')
    expect(msg).toBeTruthy()
    expect(msg.startsWith('/')).toBe(false)
  })
  it('names a regex document by its pattern and flags', () => {
    expect(flagsToString({ g: true, i: false, m: true })).toBe('gm')
    expect(regexAutoName({ pattern: 'a+', flags: { g: true, i: true } })).toBe('/a+/gi')
    expect(regexAutoName({ pattern: '', flags: {} })).toBe('Untitled')
  })
})

describe('Documents on a phone', () => {
  it('shows one tool at a time and switches between them', async () => {
    render(<DocumentsPhone/>)
    expect(screen.getByLabelText('Markdown')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(await screen.findByLabelText('JSON')).toBeTruthy()
    expect(screen.queryByLabelText('Markdown')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Regex' }))
    expect(await screen.findByLabelText('Pattern')).toBeTruthy()
  })

  it('autosaves typed markdown into the shared store, named by its heading', async () => {
    render(<DocumentsPhone/>)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: '# Plan\n\nship it' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('md_documents')).docs[0].autoName).toBe('Plan'), { timeout: 3000 })
  })

  it('opens on the most recent saved markdown document', () => {
    localStorage.setItem('md_documents', JSON.stringify({ docs: [
      { id: 'a', autoName: 'Old', content: '# Old', updatedAt: 1 },
      { id: 'b', autoName: 'New', content: '# New one', updatedAt: 2 },
    ] }))
    render(<DocumentsPhone/>)
    expect(screen.getByLabelText('Markdown').value).toBe('# New one')
  })

  it('shows a JSON error instead of the tree while the JSON is invalid', async () => {
    localStorage.setItem('documents_active_tab', JSON.stringify('json'))
    render(<DocumentsPhone/>)
    fireEvent.change(await screen.findByLabelText('JSON'), { target: { value: '{"a":' } })
    expect(screen.getByText('Invalid JSON')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Fix the JSON/)
  })
})
