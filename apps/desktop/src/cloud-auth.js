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
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.setItem(k, JSON.stringify(auth)) }
  catch (err) { console.warn(`[cloud-auth] failed to persist ${suffix}:`, err?.message || err) }
}
function clear(suffix) {
  try { const k = getProfileKey('nexusmd.' + suffix); if (k) localStorage.removeItem(k) }
  catch (err) { console.warn(`[cloud-auth] failed to clear ${suffix}:`, err?.message || err) }
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        console.info(`[cloud-auth] Initiating ${key} OAuth connection`)
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) { 
          console.warn(`[cloud-auth] ${key} sign-in not configured on server`)
          toast?.(`${key} sign-in is not configured on the server.`, 'error')
          return 
        }
        const { url } = await res.json()
        console.info(`[cloud-auth] Redirecting to ${key} OAuth provider`)
        await window.electronAPI.openExternal(url)
      } catch (err) { 
        console.error(`[cloud-auth] Failed to initiate ${key} connection:`, err.message)
        toast?.('Sign-in failed. Please try again.', 'error') 
      }
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
      } catch (err) { console.warn('[cloud-auth] token refresh failed:', err?.message || err); return null }
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
  console.info('[cloud-auth] Redeeming OAuth code')
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
    if (!res.ok) {
      const errText = await res.text()
      console.error(`[cloud-auth] OAuth exchange failed: HTTP ${res.status} - ${errText}`)
      return
    }
    const { accessToken, refreshToken } = await res.json()
    console.info(`[cloud-auth] OAuth successful, saved tokens`)
    write(cfg.keySuffix, { accessToken, refreshToken })
    window.location.reload()
  } catch (err) { console.error('[cloud-auth] OAuth redeem failed:', err?.stack || err) }
}

export function registerCloudDeepLink() {
  if (window.electronAPI?.onDeepLink) window.electronAPI.onDeepLink(redeem)
}

// Native desktop OAuth binding for any provider whose flow runs in the Electron
// main process (PKCE loopback). `provider` is passed to the IPC bridge; tokens are
// stored under localStorage `suffix`. Handles providers that rotate refresh tokens.
export function makeNativeBinding({ provider, suffix }) {
  return {
    isConnected: () => Boolean(read(suffix)?.accessToken),
    async connect() {
      try {
        console.info(`[cloud-auth] Initiating ${provider} OAuth connection (native)`)
        const tokens = await window.electronAPI.oauth.start(provider)
        write(suffix, tokens)
        console.info(`[cloud-auth] ${provider} OAuth connected`)
        window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
      } catch (err) {
        console.error(`[cloud-auth] Failed to connect ${provider}:`, err?.stack || err)
        toast?.('Sign-in failed. Please try again.', 'error')
      }
    },
    async disconnect() { clear(suffix) },
    async getToken({ force } = {}) {
      const auth = read(suffix)
      if (!auth?.accessToken) return null
      const expired = auth.expiresAt && Date.now() > auth.expiresAt - 60_000
      if (!force && !expired) return auth.accessToken
      try {
        const next = await window.electronAPI.oauth.refresh(auth.refreshToken, provider)
        if (!next?.accessToken) return force ? null : auth.accessToken
        write(suffix, { ...auth, ...next })   // ...next carries a rotated refreshToken when present
        return next.accessToken
      } catch (err) {
        console.error(`[cloud-auth] ${provider} token refresh failed:`, err?.stack || err)
        return force ? null : auth.accessToken
      }
    },
  }
}

export function makeNativeGoogleBinding() {
  return makeNativeBinding({ provider: 'google', suffix: 'google.auth' })
}
export function makeNativeMicrosoftBinding() {
  return makeNativeBinding({ provider: 'microsoft', suffix: 'microsoft.auth' })
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeNativeGoogleBinding()),
  makeOneDriveProvider(makeNativeMicrosoftBinding()),
]

export function makeDesktopOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(read(cfg.keySuffix)?.accessToken),
    async connect() {
      try {
        console.info(`[cloud-auth] Initiating ${from} OAuth connection`)
        const returnUri = `nexusmd://oauth/${cfg.from}`
        const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
        if (!res.ok) { 
          console.warn(`[cloud-auth] ${from} sign-in not configured on server`)
          toast?.(`${from} sign-in is not configured on the server.`, 'error')
          return 
        }
        const { url } = await res.json()
        console.info(`[cloud-auth] Redirecting to ${from} OAuth provider`)
        await window.electronAPI.openExternal(url)
      } catch (err) { 
        console.error(`[cloud-auth] Failed to initiate ${from} connection:`, err.message)
        toast?.('Sign-in failed. Please try again.', 'error') 
      }
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
      } catch (err) { console.warn('[cloud-auth] token refresh failed:', err?.message || err); return null }
    },
    async loadCreds() {
      try {
        const k = getProfileKey('nexusmd.' + from + '.oauthCreds')
        if (!k) return {}
        const raw = await secureStorageAdapter.get(k)
        return raw ? JSON.parse(raw) : {}
      } catch (err) { console.warn('[cloud-auth] loadCreds failed:', err?.message || err); return {} }
    },
    async saveCreds(c) {
      try {
        const k = getProfileKey('nexusmd.' + from + '.oauthCreds')
        if (k) await secureStorageAdapter.set(k, JSON.stringify(c))
      } catch (err) { console.warn('[cloud-auth] saveCreds failed:', err?.message || err) }
    },
  }
}
