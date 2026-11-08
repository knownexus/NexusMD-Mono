import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createEditorStore } from './editor-store.js'
import { EditorApp } from './editor-app.jsx'

// The Editor on a phone: eight open files, a long file name, a narrow screen. jsdom has no layout, so the CSS rules that keep the
// tab strip and the toolbar inside the screen are read from the stylesheet, and the one thing code must do (scroll the open tab into
// view) is checked in the rendered component.
const file = './editor.css' // a variable, so Vite does not treat the URL as an asset
const css = readFileSync(new URL(file, import.meta.url), 'utf8')
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

beforeEach(() => {
  Range.prototype.getClientRects ??= () => []
  Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
})
afterEach(cleanup)

describe('the Editor tab strip', () => {
  it('keeps every tab on one line at full width, so the strip stays one row tall and scrolls sideways', () => {
    expect(rule('.nx-ed-tab')).toMatch(/flex-shrink:\s*0/)
    expect(rule('.nx-ed-tab-name, .nx-ed-tab-close')).toMatch(/white-space:\s*nowrap/)
    expect(rule('.nx-ed-tabs')).toMatch(/overflow-x:\s*auto/)
    expect(rule('.nx-ed-tabs')).toMatch(/flex-shrink:\s*0/)
  })

  it('scrolls the open tab into view when it changes', async () => {
    const scrolled = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { scrolled.push(this.getAttribute('title')) }
    try {
      const files = Object.fromEntries(['a', 'b', 'c', 'd'].map(n => [`/w/${n}.txt`, n]))
      const api = {
        stat: vi.fn(async () => ({ exists: true, kind: 'file' })),
        read: vi.fn(async p => ({ path: p, text: files[p], bom: false, stamp: 's' })),
        write: vi.fn(), list: vi.fn(async () => ({ entries: [], truncated: false })),
      }
      const store = createEditorStore({ api })
      render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
      for (const p of Object.keys(files)) await store.openFile(p)
      await screen.findByRole('textbox', { name: /Editing / })
      expect(scrolled.at(-1)).toBe('/w/d.txt')
      scrolled.length = 0
      store.activate('/w/a.txt')
      await screen.findByRole('tab', { selected: true })
      await vi.waitFor(() => expect(scrolled.at(-1)).toBe('/w/a.txt'))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})

describe('the Editor on a short screen', () => {
  // A phone turned sideways is about 390px tall. The title, toolbar and tabs take about 160px, so a text box that insists on 240px
  // pushes the status row (path, Saved, Prettify, Save) off the bottom of the screen with no way to scroll to it.
  it('lets the text box shrink to leave the status row on screen', async () => {
    const api = {
      stat: vi.fn(async () => ({ exists: true, kind: 'file' })),
      read: vi.fn(async p => ({ path: p, text: 'x', bom: false, stamp: 's' })),
      write: vi.fn(), list: vi.fn(async () => ({ entries: [], truncated: false })),
    }
    const store = createEditorStore({ api })
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
    await store.openFile('/w/a.js')
    await screen.findByRole('textbox', { name: /Editing / })
    const box = document.querySelector('.cm-editor').parentElement
    expect(parseInt(box.style.minHeight, 10)).toBeLessThanOrEqual(120)
  })
  it('lets the Markdown preview shrink the same way', () => {
    expect(parseInt(rule('.nx-ed-preview').match(/min-height:\s*(\d+)px/)?.[1], 10)).toBeLessThanOrEqual(120)
  })
})

describe('the Editor while typing on a short screen (soft keyboard up)', () => {
  // With the keyboard open a phone has about 340px of height. The toolbar and tab strip are hidden while the person is typing in the
  // text, so the status row with Prettify and Save keeps room. They must not vanish for a tap on a tab or on Prettify/Save, or the
  // layout would jump under the finger.
  async function open() {
    const files = { '/w/a.js': 'a', '/w/b.js': 'b' }
    const api = {
      stat: vi.fn(async () => ({ exists: true, kind: 'file' })),
      read: vi.fn(async p => ({ path: p, text: files[p], bom: false, stamp: 's' })),
      write: vi.fn(), list: vi.fn(async () => ({ entries: [], truncated: false })),
    }
    const store = createEditorStore({ api })
    render(<EditorApp host={{ adapters: { picker: {} } }} store={store} api={api} />)
    await store.openFile('/w/a.js')
    await store.openFile('/w/b.js')
    await screen.findByRole('textbox', { name: /Editing / })
    return { root: document.querySelector('.nx-ed') }
  }
  const typing = root => root.classList.contains('nx-ed-typing')

  it('marks the Editor as typing while the text has focus, and clears it when focus leaves', async () => {
    const { root } = await open()
    expect(typing(root)).toBe(false)
    act(() => { document.querySelector('.cm-content').focus() })
    expect(typing(root)).toBe(true)
    act(() => { document.activeElement.blur() })
    expect(typing(root)).toBe(false)
  })

  it('stays typing when focus moves to Prettify or Save, so the layout does not move under a tap on them', async () => {
    const { root } = await open()
    act(() => { document.querySelector('.cm-content').focus() })
    act(() => { screen.getByRole('button', { name: 'Prettify' }).focus() })
    expect(typing(root)).toBe(true)
    act(() => { screen.getByRole('button', { name: 'Save' }).focus() })
    expect(typing(root)).toBe(true)
  })

  it('is not typing when focus moves to a tab or the toolbar, which stay on screen', async () => {
    const { root } = await open()
    act(() => { document.querySelector('.cm-content').focus() })
    act(() => { screen.getAllByRole('tab')[0].querySelector('button').focus() })
    expect(typing(root)).toBe(false)
    act(() => { document.querySelector('.cm-content').focus() })
    act(() => { screen.getByRole('button', { name: 'Open file…' }).focus() })
    expect(typing(root)).toBe(false)
  })

  it('hides the toolbar and tab strip only while typing, and only on a short screen', () => {
    const block = css.match(/@media \(max-height:\s*560px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(block).toMatch(/\.nx-ed-typing \.nx-ed-bar/)
    expect(block).toMatch(/\.nx-ed-typing \.nx-ed-tabs/)
    expect(block).toMatch(/display:\s*none/)
  })
})

describe('the Editor toolbar', () => {
  it('wraps onto a second row instead of running off the edge, and lets the Recent list shrink', () => {
    expect(rule('.nx-ed-bar')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.nx-ed-recent')).toMatch(/min-width:\s*0/)
  })
})
