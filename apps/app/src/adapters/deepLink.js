// Deep-link adapter — uses @capacitor/app appUrlOpen (its web build is a safe
// no-op listener off-device), falling back to a one-shot read of the current URL.
import { App as CapApp } from '@capacitor/app'

export const deepLinkAdapter = {
  onLink(cb) {
    if (CapApp?.addListener) {
      const sub = CapApp.addListener('appUrlOpen', (e) => { if (e?.url) cb(e.url) })
      return () => { try { sub.then(s => s.remove()) } catch {} }
    }
    const url = window.location.href
    if (url.includes('nexusmd://') || url.includes('?link=')) setTimeout(() => cb(url), 0)
    return () => {}
  },
  isAvailable() {
    return Boolean(CapApp?.addListener)
  },
}
