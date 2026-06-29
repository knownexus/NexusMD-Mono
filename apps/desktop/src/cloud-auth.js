// cloud-auth.js — desktop OAuth bindings for profile cloud sync (Drive + OneDrive).
// Desktop opens the system browser to the web backend's native-url; the backend
// redirects back via the nexusmd:// custom protocol with a one-time code, which
// the renderer redeems for tokens. Requires VITE_API_BASE to point at the host.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   api: '/api/google/auth', from: 'gdrive' },
  onedrive: { keySuffix: 'onedrive.auth', api: '/api/ms/auth',     from: 'onedrive' },
}

function read(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); return k ? JSON.parse(localStorage.getItem(k) || 'null') : null }
  catch { return null }
}
function write(suffix, auth) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) } catch {}
}
function clear(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.removeItem(k) } catch {}
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
        await window.electronAPI.openExternal(url)
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

// Map provider marker (?provider=gdrive|onedrive) to its config + storage suffix.
const BY_FROM = { gdrive: PROVIDERS.gdrive, onedrive: PROVIDERS.onedrive }

// Redeem the one-time code delivered via the nexusmd:// deep link.
async function redeem(url) {
  let u
  try { u = new URL(url) } catch { return }
  const params = u.searchParams
  const from = params.get('provider')
  const otc = params.get('otc')
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
  if (window.electronAPI?.onDeepLink) window.electronAPI.onDeepLink(redeem)
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
