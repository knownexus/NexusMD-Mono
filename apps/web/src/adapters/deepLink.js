export const deepLinkAdapter = {
  onLink(cb) {
    const params = new URLSearchParams(window.location.search)
    const link = params.get('link')
    if (link) setTimeout(() => cb(link), 0)
    return () => {}
  },
  isAvailable() {
    return true
  },
}
