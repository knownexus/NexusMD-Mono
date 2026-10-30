// The colour palettes every platform offers (their tokens live in styles/base.css), ordered from
// lightest to darkest so the theme picker reads as one scale. `tone` is how light the palette is.
export const NEXUSMD_THEMES = [
  { id: 'parchment', label: 'Parchment', tone: 'light', swatch: ['#f4f1e8', '#ebe5d4', '#9a7e22'] },
  { id: 'paper',     label: 'Paper',     tone: 'light', swatch: ['#f5f5f5', '#e8e8e8', '#1d6fcc'] },
  { id: 'dusk',      label: 'Dusk',      tone: 'light', swatch: ['#e4e0d2', '#dbd5c2', '#9a7e22'] },
  { id: 'umber',     label: 'Umber',     tone: 'dim',   swatch: ['#3b3731', '#4f4a42', '#d9b85a'] },
  { id: 'pewter',    label: 'Pewter',    tone: 'dim',   swatch: ['#343a43', '#474f5a', '#94c3ff'] },
  { id: 'lichen',    label: 'Lichen',    tone: 'dim',   swatch: ['#353b36', '#48504a', '#86d19c'] },
  { id: 'slate',     label: 'Slate',     tone: 'dark',  swatch: ['#1a1c20', '#2a2e38', '#8098e0'] },
  { id: 'cobalt',    label: 'Cobalt',    tone: 'dark',  swatch: ['#0d1620', '#1f2c3b', '#4a9eff'] },
  { id: 'noir',      label: 'Noir',      tone: 'dark',  swatch: ['#171410', '#282420', '#e8a020'] },
  { id: 'forest',    label: 'Forest',    tone: 'dark',  swatch: ['#0e1812', '#1c2a20', '#48b870'] },
]

// The modes the user switches between, each with the tweak that holds its palette and that palette's default.
export const THEME_MODES = [
  { id: 'light', label: 'Light', icon: 'sun',    key: 'lightTheme', fallback: 'parchment' },
  { id: 'dim',   label: 'Dim',   icon: 'sunset', key: 'dimTheme',   fallback: 'umber' },
  { id: 'dark',  label: 'Dark',  icon: 'moon',   key: 'darkTheme',  fallback: 'cobalt' },
]

const modeOf = (id) => THEME_MODES.find(m => m.id === id) || THEME_MODES[0]

/** The palette id to put on body[data-theme] for the user's tweaks. */
export function paletteFor(tweaks = {}) {
  const mode = modeOf(tweaks.theme)
  return tweaks[mode.key] || mode.fallback
}

/** The mode after this one, wrapping from dark back to light. */
export function nextThemeMode(id) {
  const i = THEME_MODES.indexOf(modeOf(id))
  return THEME_MODES[(i + 1) % THEME_MODES.length]
}

/** Whether a palette has light text on a darker ground (dim and dark palettes do). */
export function isDarkPalette(id) {
  const theme = NEXUSMD_THEMES.find(t => t.id === id)
  return !!theme && theme.tone !== 'light'
}
