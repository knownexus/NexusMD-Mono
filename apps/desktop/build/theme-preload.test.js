// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NEXUSMD_THEMES } from '../../../packages/ui/src/themes.js'
import { themePreloadScript, THEME_BACKGROUNDS } from './theme-preload.mjs'

// Runs the inline script against a stand-in page and storage, as the window would before any CSS loads.
function run(saved) {
  const page = { body: { dataset: {} }, documentElement: { style: {} } }
  const storage = { getItem: k => (k === 'nexusmd.tweaks' ? saved ?? null : null) }
  new Function('localStorage', 'document', themePreloadScript())(storage, page)
  return { theme: page.body.dataset.theme, background: page.documentElement.style.backgroundColor }
}

describe('the theme preload script', () => {
  it('applies the saved palette and its background before the app loads', () => {
    expect(run(JSON.stringify({ theme: 'dark', darkTheme: 'noir' }))).toEqual({ theme: 'noir', background: '#171410' })
    expect(run(JSON.stringify({ theme: 'dim' }))).toEqual({ theme: 'umber', background: '#3b3731' })
  })

  it('falls back to the default light palette with nothing saved or something unreadable', () => {
    expect(run(null)).toEqual({ theme: 'parchment', background: '#f4f1e8' })
    expect(run('{not json')).toEqual({ theme: 'parchment', background: '#f4f1e8' })
  })

  it("uses each palette's own --bg from the stylesheet", () => {
    const css = readFileSync(new URL('../../../packages/ui/src/styles/base.css', import.meta.url), 'utf8')
    const bgOf = id => {
      const block = id === 'parchment' ? css.slice(css.indexOf(':root {')) : css.slice(css.indexOf(`[data-theme="${id}"] {`))
      return block.match(/--bg:\s*(#[0-9a-f]+)/i)[1].toLowerCase()
    }
    for (const t of NEXUSMD_THEMES) expect(THEME_BACKGROUNDS[t.id]).toBe(bgOf(t.id))
  })
})
