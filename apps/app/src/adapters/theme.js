const mql = window.matchMedia?.('(prefers-color-scheme: dark)')

export const themeAdapter = {
  getColorScheme() {
    return mql?.matches ? 'dark' : 'light'
  },
  onChange(cb) {
    const handler = (e) => cb(e.matches ? 'dark' : 'light')
    mql?.addEventListener('change', handler)
    return () => mql?.removeEventListener('change', handler)
  },
}
