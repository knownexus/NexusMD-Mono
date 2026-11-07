import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { undo } from '@codemirror/commands'
import { createEditorStore } from './editor-store.js'

// The real CodeEditor and the real formatters are used here (the Prettify button hands text to one and gets text from the other).
// Only the moment the formatter answers can be held back, to test a result that arrives after the person kept typing.
const gate = vi.hoisted(() => ({ hold: null }))
vi.mock('@nexusmd/editor-kit/prettify.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, prettify: (path, text) => (gate.hold ? gate.hold(path, text) : real.prettify(path, text)) }
})

import { EditorApp } from './editor-app.jsx'

// jsdom has no layout; CodeMirror measures text ranges after an edit.
beforeEach(() => {
  Range.prototype.getClientRects ??= () => []
  Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
})
afterEach(() => { cleanup(); gate.hold = null })

function fakeDisk(files) {
  const disk = new Map(Object.entries(files))
  const stamp = t => `s:${t}`
  return {
    disk,
    stat: vi.fn(async p => (disk.has(p) ? { exists: true, kind: 'file' } : { exists: false })),
    read: vi.fn(async p => (disk.has(p) ? { path: p, text: disk.get(p), bom: false, stamp: stamp(disk.get(p)) } : { missing: true })),
    write: vi.fn(async (p, text) => { disk.set(p, text); return { ok: true, stamp: stamp(text) } }),
    list: vi.fn(async () => ({ entries: [], truncated: false })),
  }
}

async function setup(files, open) {
  const api = fakeDisk(files)
  const store = createEditorStore({ api })
  render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
  await store.openFile(open ?? Object.keys(files)[0])
  await screen.findByRole('textbox', { name: /Editing / })
  return { api, store }
}

const textOf = (store, path) => store.getState().docs.find(d => d.path === path).text
const viewOf = () => EditorView.findFromDOM(document.querySelector('.cm-editor'))
const prettifyButton = () => screen.queryByRole('button', { name: 'Prettify' })
const tap = () => fireEvent.click(screen.getByRole('button', { name: 'Prettify' }))

describe('the Prettify button', () => {
  it('shows for JSON and TypeScript files but not for C# or plain text', async () => {
    for (const [path, expected] of [['/w/a.json', true], ['/w/b.ts', true], ['/w/c.cs', false], ['/w/d.txt', false]]) {
      const { store } = await setup({ [path]: 'x' })
      expect(!!prettifyButton(), path).toBe(expected)
      cleanup()
      store.close(path)
    }
  })

  it('shows for an upper-case .JSON name too', async () => {
    await setup({ '/w/DATA.JSON': '{"a":1}' })
    expect(prettifyButton()).toBeTruthy()
  })

  it('is not there for read-only text', async () => {
    const store = createEditorStore({ api: fakeDisk({}) })
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={fakeDisk({})} />)
    store.openText({ id: 'x:a.json', name: 'a.json', text: '{"a":1}', origin: 'somewhere' })
    await screen.findByText('Read-only')
    expect(prettifyButton()).toBeNull()
  })
})

describe('tapping Prettify', () => {
  it('replaces the text with the tidy version and marks the file unsaved', async () => {
    const { store } = await setup({ '/w/a.json': '{"a":1}' })
    expect(screen.getByText('Saved')).toBeTruthy()
    tap()
    await waitFor(() => expect(textOf(store, '/w/a.json')).toBe('{\n  "a": 1\n}\n'))
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(viewOf().state.doc.toString()).toBe('{\n  "a": 1\n}\n')
  })

  it('writes nothing until the person saves', async () => {
    const { api, store } = await setup({ '/w/a.json': '{"a":1}' })
    tap()
    await waitFor(() => expect(textOf(store, '/w/a.json')).toContain('\n'))
    expect(api.write).not.toHaveBeenCalled()
    expect(api.disk.get('/w/a.json')).toBe('{"a":1}')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.disk.get('/w/a.json')).toBe('{\n  "a": 1\n}\n'))
  })

  it('can be undone, bringing the previous text back', async () => {
    const { store } = await setup({ '/w/a.json': '{"a":1}' })
    tap()
    await waitFor(() => expect(textOf(store, '/w/a.json')).toBe('{\n  "a": 1\n}\n'))
    act(() => { undo(viewOf()) })
    await waitFor(() => expect(textOf(store, '/w/a.json')).toBe('{"a":1}'))
  })

  it('a broken file shows the reason and keeps its text', async () => {
    const { store } = await setup({ '/w/a.json': '{ "a": ' })
    tap()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Could not tidy: \S/)
    expect(textOf(store, '/w/a.json')).toBe('{ "a": ')
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('the reason goes away when the text changes', async () => {
    await setup({ '/w/a.json': '{ "a": ' })
    tap()
    await screen.findByRole('alert')
    act(() => { viewOf().dispatch({ changes: { from: 7, insert: '1 }' } }) })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('an already tidy file says so, and is not marked unsaved', async () => {
    const { store } = await setup({ '/w/a.json': '{\n  "a": 1\n}\n' })
    tap()
    expect((await screen.findByRole('status')).textContent).toBe('Already tidy')
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(textOf(store, '/w/a.json')).toBe('{\n  "a": 1\n}\n')
  })

  it('drops a result that arrives after the text changed, with no message', async () => {
    const { store } = await setup({ '/w/a.json': '{"a":1}' })
    let answer
    gate.hold = () => new Promise(resolve => { answer = resolve })
    tap()
    expect(screen.getByRole('button', { name: 'Prettify' }).disabled).toBe(true)
    act(() => { viewOf().dispatch({ changes: { from: 7, insert: ' ' } }) }) // the person keeps typing
    await waitFor(() => expect(textOf(store, '/w/a.json')).toBe('{"a":1} '))
    await act(async () => { answer({ ok: true, text: '{\n  "a": 1\n}\n' }) })
    expect(textOf(store, '/w/a.json')).toBe('{"a":1} ')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Prettify' }).disabled).toBe(false)
  })

  it('does not tidy a result for another tab when the person switched meanwhile', async () => {
    const api = fakeDisk({ '/w/a.json': '{"a":1}', '/w/b.json': '{"b":2}' })
    const store = createEditorStore({ api })
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
    await store.openFile('/w/a.json'); await store.openFile('/w/b.json')
    await screen.findByRole('textbox', { name: /Editing b\.json/ })
    store.activate?.('/w/a.json')
    let answer
    gate.hold = () => new Promise(resolve => { answer = resolve })
    await screen.findByRole('textbox', { name: /Editing a\.json/ })
    tap()
    await act(async () => { store.activate?.('/w/b.json') })
    await act(async () => { answer({ ok: true, text: '{\n  "a": 1\n}\n' }) })
    expect(textOf(store, '/w/a.json')).toBe('{"a":1}')
    expect(textOf(store, '/w/b.json')).toBe('{"b":2}')
  })
})
