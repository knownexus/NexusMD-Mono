// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { NEXUSMD_THEMES, THEME_MODES, paletteFor, nextThemeMode, isDarkPalette } from './themes.js'

describe('themes', () => {
  it('uses the palette assigned to the active mode', () => {
    const tweaks = { lightTheme: 'paper', dimTheme: 'pewter', darkTheme: 'noir' }
    expect(paletteFor({ ...tweaks, theme: 'light' })).toBe('paper')
    expect(paletteFor({ ...tweaks, theme: 'dim' })).toBe('pewter')
    expect(paletteFor({ ...tweaks, theme: 'dark' })).toBe('noir')
  })

  it('falls back to each mode’s default palette, and to light for an unknown mode', () => {
    expect(paletteFor({ theme: 'light' })).toBe('parchment')
    expect(paletteFor({ theme: 'dim' })).toBe('umber')
    expect(paletteFor({ theme: 'dark' })).toBe('cobalt')
    expect(paletteFor({ theme: 'sepia', lightTheme: 'dusk' })).toBe('dusk')
    expect(paletteFor()).toBe('parchment')
  })

  it('cycles light, dim, dark and back to light', () => {
    expect(nextThemeMode('light').id).toBe('dim')
    expect(nextThemeMode('dim').id).toBe('dark')
    expect(nextThemeMode('dark').id).toBe('light')
    expect(nextThemeMode(undefined).id).toBe('dim')
  })

  it('treats dim and dark palettes as dark for code highlighting', () => {
    expect(isDarkPalette('parchment')).toBe(false)
    expect(isDarkPalette('umber')).toBe(true)
    expect(isDarkPalette('cobalt')).toBe(true)
    expect(isDarkPalette(undefined)).toBe(false)
  })

  it('has CSS tokens for every palette and a default palette of the right tone for each mode', () => {
    const css = readFileSync(new URL('./styles/base.css', import.meta.url), 'utf8')
    for (const t of NEXUSMD_THEMES) {
      if (t.id !== 'parchment') expect(css).toContain(`[data-theme="${t.id}"] {`)
    }
    for (const m of THEME_MODES) {
      expect(NEXUSMD_THEMES.find(t => t.id === m.fallback)?.tone).toBe(m.id)
    }
  })
})
