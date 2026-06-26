export const deepLinkAdapter = {
  onLink(cb) {
    // No Capacitor appUrlOpen — fire once with current URL if it looks like a deep link
    const url = window.location.href
    if (url.includes('nexusmd://') || url.includes('?link=')) {
      setTimeout(() => cb(url), 0)
    }
    // Return no-op unsubscribe (can't unsubscribe from one-shot URL)
    return () => {}
  },
  isAvailable() {
    return false  // full deep link routing needs Capacitor App plugin
  },
}
