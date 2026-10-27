// Opening links from the renderer: a tab in the shared link window (openLink) and the
// system browser / custom-protocol handler (openExternal). Both read window.electronAPI
// at call time, so a missing bridge only matters when a caller actually uses it.
const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

export const linkAdapter = {
  canOpenLink() { return typeof api()?.openLink === 'function' },
  openLink(url) { return api().openLink(url) },
  canOpenExternal() { return typeof api()?.openExternal === 'function' },
  openExternal(url) { return api().openExternal(url) },
}
