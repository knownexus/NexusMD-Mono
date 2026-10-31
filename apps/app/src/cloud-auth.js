// cloud-auth.js — app (Capacitor) OAuth bindings for profile cloud sync.
// Opens the system browser to the backend native-url; the backend redirects to
// nexusmd://oauth/<provider>?provider=&otc=, captured via the deepLinkAdapter,
// then redeemed for tokens. Tokens stored per-profile under the `helm` namespace.
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider } from '@nexusmd/core'
import { toast } from './toast.jsx'
import { deepLinkAdapter } from './adapters/deepLink.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'https://nexusmd.app'

const PROVIDERS = {
  gdrive:    { keySuffix: 'gdrive.auth',    api: '/api/google/auth', from: 'gdrive' },
  onedrive:  { keySuffix: 'onedrive.auth',  api: '/api/ms/auth',     from: 'onedrive' },
  ado:       { keySuffix: 'ado.auth',       api: '/api/ado/auth',    from: 'ado' },
  microsoft: { keySuffix: 'microsoft.auth', api: '/api/ms/auth',     from: 'microsoft' },
  github:    { keySuffix: 'github.auth',    api: '/api/github/auth', from: 'github' },
  // Google sign-in for the calendar. Same server endpoints as Drive, kept as its own connection.
  google:    { keySuffix: 'google.auth',    api: '/api/google/auth', from: 'google' },
}
const BY_FROM = {
  gdrive:    PROVIDERS.gdrive,
  onedrive:  PROVIDERS.onedrive,
  ado:       PROVIDERS.ado,
  microsoft: PROVIDERS.microsoft,
  github:    PROVIDERS.github,
  google:    PROVIDERS.google,
}

// tokenCache is keyed by the RESOLVED profile key so a profile switch can never
// return another profile's tokens. isConnected() reads the cache synchronously;
// the adapter (async, encrypted) is the durable store.
const tokenCache = new Map()
const resolveKey = (suffix) => getProfileKey('helm.' + suffix)

function readAuth(suffix) {
  const k = resolveKey(suffix)
  return k ? (tokenCache.get(k) || null) : null
}
async function writeAuth(suffix, auth) {
  const k = resolveKey(suffix)
  if (!k) return
  tokenCache.set(k, auth)
  await secureStorageAdapter.set(k, JSON.stringify(auth))
}
async function clearAuth(suffix) {
  const k = resolveKey(suffix)
  if (!k) return
  tokenCache.delete(k)
  await secureStorageAdapter.remove(k)
}

// Open the system browser. In a Capacitor WebView, target '_system' hands the
// URL to the OS browser; on web it falls back to a normal new-tab/navigation.
function openBrowser(url) {
  if (!window.open(url, '_system')) window.location.href = url
}

const apiHost = () => { try { return new URL(API_BASE).host } catch { return API_BASE } }

// Say why sign-in did not start, instead of nothing happening.
export async function signInFailure(res) {
  let error = ''
  try { error = (await res.json())?.error || '' } catch { /* not JSON */ }
  if (/not configured/i.test(error)) return `The sign-in server (${apiHost()}) has no client ID for this provider yet.`
  if (/returnUri/i.test(error)) return `The sign-in server (${apiHost()}) does not accept this app's return link.`
  return `The sign-in server (${apiHost()}) answered ${res.status}${error ? `: ${error}` : ''}.`
}

// Ask the sign-in server for the provider's consent URL and open it in the system browser. Every way this can
// fail says so, instead of the button doing nothing.
export async function startSignIn(cfg) {
  try {
    const returnUri = `nexusmd://oauth/${cfg.from}`
    const res = await fetch(`${API_BASE}${cfg.api}/native-url?returnUri=${encodeURIComponent(returnUri)}`)
    if (!res.ok) { toast?.(await signInFailure(res), 'error'); return }
    const { url } = await res.json()
    markPending(cfg.from)
    openBrowser(url)
  } catch {
    toast?.(`Can't reach the sign-in server (${apiHost()}). Check your connection, or that the server is running.`, 'error')
  }
}

function makeBinding(key) {
  const cfg = PROVIDERS[key]
  return {
    isConnected: () => Boolean(readAuth(cfg.keySuffix)?.accessToken),
    connect: () => startSignIn(cfg),
    async disconnect() {
      await clearAuth(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async getToken({ force } = {}) {
      const auth = readAuth(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const res = await fetch(`${API_BASE}${cfg.api}/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        })
        if (!res.ok) return null
        const { accessToken } = await res.json()
        await writeAuth(cfg.keySuffix, { ...auth, accessToken })
        return accessToken
      } catch { return null }
    },
  }
}

// A sign-in only counts if this app started it: connect() records the provider, and
// redeem() takes that record exactly once. Stops a stray or crafted nexusmd://oauth link
// from storing tokens in a slot the user never signed into.
const PENDING_KEY = 'nexusmd.oauth.pending'
const PENDING_TTL_MS = 10 * 60 * 1000
export function markPending(from, now = Date.now()) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ from, at: now })) } catch {}
}
export function takePending(from, now = Date.now()) {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    const ok = Boolean(p && p.from === from && now - p.at >= 0 && now - p.at <= PENDING_TTL_MS)
    // Only a matching link uses the record up, so a forged one can't cancel the real sign-in.
    if (ok || (p && now - p.at > PENDING_TTL_MS)) localStorage.removeItem(PENDING_KEY)
    return ok
  } catch { return false }
}

async function redeem(url) {
  let u
  try { u = new URL(url) } catch { return }
  const from = u.searchParams.get('provider')
  const otc = u.searchParams.get('otc')
  const cfg = from && BY_FROM[from]
  if (!cfg || !otc) return
  if (u.protocol !== 'nexusmd:' || u.hostname !== 'oauth') return
  // The link's own path must name the same provider, and this app must have started that sign-in.
  if (u.pathname.replace(/^\/+/, '') !== cfg.from) return
  if (!takePending(cfg.from)) return
  try {
    const res = await fetch(`${API_BASE}${cfg.api}/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: otc }),
    })
    if (!res.ok) return
    const { accessToken, refreshToken } = await res.json()
    await writeAuth(cfg.keySuffix, { accessToken, refreshToken })
    window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    window.location.reload()
  } catch {}
}

export function registerCloudDeepLink() {
  deepLinkAdapter.onLink(redeem)
}

// Decrypt each provider's stored auth into the in-memory cache. Called at startup
// and after a profile switch; dispatches so the settings card re-reads state.
export async function hydrateCloudTokens() {
  for (const cfg of Object.values(PROVIDERS)) {
    const k = resolveKey(cfg.keySuffix)
    if (!k) continue
    try {
      const raw = await secureStorageAdapter.get(k)
      if (raw) tokenCache.set(k, JSON.parse(raw))
      else tokenCache.delete(k)
    } catch { tokenCache.delete(k) }
  }
  window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
}

// Bearer-style access for other modules (Google Calendar): current token, or a refreshed one.
export function getOAuthToken(from, opts) { return makeBinding(from).getToken(opts) }
export function isOAuthConnected(from) { return makeBinding(from).isConnected() }

export const appCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]

export function makeAppOAuthService(from) {
  const cfg = PROVIDERS[from]
  return {
    isConnected: () => Boolean(readAuth(cfg.keySuffix)?.accessToken),
    connect: () => startSignIn(cfg),
    async disconnect() {
      await clearAuth(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async loadCreds() {
      try {
        const k = resolveKey(from + '.oauthCreds')
        if (!k) return {}
        const raw = await secureStorageAdapter.get(k)
        return raw ? JSON.parse(raw) : {}
      } catch { return {} }
    },
    async saveCreds(c) {
      try {
        const k = resolveKey(from + '.oauthCreds')
        if (k) await secureStorageAdapter.set(k, JSON.stringify(c))
      } catch {}
    },
  }
}
