// cloud-auth.js — web OAuth bindings for profile cloud sync (Drive + OneDrive).
// Tokens are stored per-profile, mirroring google-auth.js:
//   nexusmd.p.<id>.gdrive.auth / .onedrive.auth = { accessToken, refreshToken, email }
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/ui'
import { toast } from './toast.jsx'

// provider config: storage key suffix, backend route base, redirect marker.
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
        const redirectUri = window.location.origin + '/?from=' + cfg.from
        const res = await fetch(`${cfg.api}/url?redirectUri=${encodeURIComponent(redirectUri)}`,
          { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) { toast?.(`${key} sign-in is not configured on the server.`, 'error'); return }
        const { url } = await res.json()
        window.location.href = url
      } catch { toast?.(`Could not reach ${key} sign-in.`, 'error') }
    },
    async disconnect() { clear(cfg.keySuffix) },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }), signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        write(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}

// Exchange the ?from=<provider>&code=… redirect for tokens (runs on load).
export async function handleCloudOAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const from = params.get('from')
  const cfg = from && PROVIDERS[from]
  if (!cfg) return
  const code = params.get('code')
  if (!code) return
  window.history.replaceState({}, '', window.location.pathname)
  try {
    const redirectUri = window.location.origin + '/?from=' + cfg.from
    const res = await fetch(`${cfg.api}/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }), signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { toast?.(`${from} sign-in failed.`, 'error'); return }
    const { accessToken, refreshToken, email } = await res.json()
    write(cfg.keySuffix, { accessToken, refreshToken, ...(email ? { email } : {}) })
    toast?.(`${from === 'gdrive' ? 'Google Drive' : 'OneDrive'} connected.`, 'success')
    document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'settings', tab: 'profiles' } }))
  } catch { toast?.(`${from} sign-in failed.`, 'error') }
}

export const webCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', handleCloudOAuthCallback)
} else {
  handleCloudOAuthCallback()
}
