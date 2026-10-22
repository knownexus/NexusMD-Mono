// Looked up on first use, not at import, so the package can be imported where there is no window.
let mql
const media = () => (mql ??= typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined)

export const themeAdapter = {
  getColorScheme() {
    return media()?.matches ? 'dark' : 'light'
  },
  onChange(cb) {
    const handler = (e) => cb(e.matches ? 'dark' : 'light')
    media()?.addEventListener('change', handler)
    return () => media()?.removeEventListener('change', handler)
  },
}
