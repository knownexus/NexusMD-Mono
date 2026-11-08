import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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

describe('the Editor toolbar', () => {
  it('wraps onto a second row instead of running off the edge, and lets the Recent list shrink', () => {
    expect(rule('.nx-ed-bar')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('.nx-ed-recent')).toMatch(/min-width:\s*0/)
  })
})
