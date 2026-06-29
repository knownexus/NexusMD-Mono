// cloud-auth.js — app (Capacitor) OAuth bindings for profile cloud sync.
// Opens the system browser to the backend native-url; the backend redirects to
// nexusmd://oauth/<provider>?provider=&otc=, captured via the deepLinkAdapter,
// then redeemed for tokens. Tokens stored per-profile under the `helm` namespace.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'
import { deepLinkAdapter } from './adapters/deepLink.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   api: '/api/google/auth', from: 'gdrive' },
  onedrive: { keySuffix: 'onedrive.auth', api: '/api/ms/auth',     from: 'onedrive' },
}
const BY_FROM = { gdrive: PROVIDERS.gdrive, onedrive: PROVIDERS.onedrive }

function read(suffix) {
  try { const k = getProfileKey('helm.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('helm.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('helm.' + suffix); if (k) localStorage.removeItem(k) } catch {}
}

// Open the system browser. In a Capacitor WebView, target '_system' hands the
// URL to the OS browser; on web it falls back to a normal new-tab/navigation.
function openBrowser(url) {
  if (!window.open(url, '_system')) window.location.href = url
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) return
        const { url } = await res.json()
        openBrowser(url)
      } catch {}
    },
    async disconnect() { clear(cfg.keySuffix) },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        write(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}

async function redeem(url) {
  let u
  try { u = new URL(url) } catch { return }
  const from = u.searchParams.get('provider')
  const otc = u.searchParams.get('otc')
  const cfg = from && BY_FROM[from]
  if (!cfg || !otc) return
  try {
    const res = await fetch(`${API_BASE}${cfg.api}/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: otc }),
    })
    if (!res.ok) return
    const { accessToken, refreshToken } = await res.json()
    write(cfg.keySuffix, { accessToken, refreshToken })
    window.location.reload()
  } catch {}
}

export function registerCloudDeepLink() {
  deepLinkAdapter.onLink(redeem)
}

export const appCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
