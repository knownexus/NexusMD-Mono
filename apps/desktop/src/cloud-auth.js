// cloud-auth.js — desktop OAuth bindings for profile cloud sync (Drive + OneDrive).
// Desktop opens the system browser to the web backend's native-url; the backend
// redirects back via the nexusmd:// custom protocol with a one-time code, which
// the renderer redeems for tokens. Requires VITE_API_BASE to point at the host.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider, toast } from '@nexusmd/ui'
import { secureStorageAdapter } from './adapters/secureStorage.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:    { keySuffix: 'gdrive.auth',    api: '/api/google/auth', from: 'gdrive' },
  onedrive:  { keySuffix: 'onedrive.auth',  api: '/api/ms/auth',     from: 'onedrive' },
  ado:       { keySuffix: 'ado.auth',       api: '/api/ado/auth',    from: 'ado' },
  microsoft: { keySuffix: 'microsoft.auth', api: '/api/ms/auth',     from: 'microsoft' },
  github:    { keySuffix: 'github.auth',    api: '/api/github/auth', from: 'github' },
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

// Map provider marker (?provider=gdrive|onedrive|ado|microsoft|github) to its config + storage suffix.
const BY_FROM = {
  gdrive:    PROVIDERS.gdrive,
  onedrive:  PROVIDERS.onedrive,
  ado:       PROVIDERS.ado,
  microsoft: PROVIDERS.microsoft,
  github:    PROVIDERS.github,
}

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

export function makeDesktopOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) { toast?.(`${from} sign-in is not configured on the server.`, 'error'); return }
        const { url } = await res.json()
        await window.electronAPI.openExternal(url)
      } catch { toast?.('Sign-in failed. Please try again.', 'error') }
    },
    async disconnect() {
      clear(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    // Retrieve the stored access token, refreshing it via the backend if force=true.
    // For the GitHub provider a 401 on refresh means the token is fully expired/revoked —
    // fire nexusmd:github-401 so the App shell can show the re-auth banner.
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) {
          if (cfg.from === 'github' && res.status === 401) {
            window.dispatchEvent(new CustomEvent('nexusmd:github-401'))
          }
          return null
        }
        const { accessToken } = await res.json()
        write(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
    async loadCreds() {
      try {
        const k = getProfileKey('nexusmd.' + from + '.oauthCreds')
        if (!k) return {}
        const raw = await secureStorageAdapter.get(k)
        return raw ? JSON.parse(raw) : {}
      } catch { return {} }
    },
    async saveCreds(c) {
      try {
        const k = getProfileKey('nexusmd.' + from + '.oauthCreds')
        if (k) await secureStorageAdapter.set(k, JSON.stringify(c))
      } catch {}
    },
  }
}
