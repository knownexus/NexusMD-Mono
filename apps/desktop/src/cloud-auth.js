// cloud-auth.js — desktop cloud sync auth bindings (Drive + OneDrive).
// The Electron main process runs an in-app PKCE loopback OAuth flow and returns
// tokens over IPC (window.electronAPI.oauth). No remote backend, no client
// secret. Tokens are stored per-profile in localStorage, mirroring the prior
// behaviour: nexusmd.p.<id>.gdrive.auth / .onedrive.auth = { accessToken, refreshToken, email }
import { getProfileKey } from './profile-keys.js'
import { makeGoogleDriveProvider, makeOneDriveProvider, toast } from '@nexusmd/ui'

const PROVIDERS = {
  gdrive:   { keySuffix: 'gdrive.auth',   flow: 'google',    label: 'Google Drive' },
  onedrive: { keySuffix: 'onedrive.auth', flow: 'microsoft', label: 'OneDrive' },
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
        const auth = await window.electronAPI.oauth.signIn(cfg.flow)
        if (!auth?.accessToken) { toast?.(`${cfg.label} sign-in failed.`, 'error'); return }
        write(cfg.keySuffix, auth)
        window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
        toast?.(`${cfg.label} connected.`, 'success')
      } catch (e) {
        toast?.(e?.message ? `${cfg.label}: ${e.message}` : `Could not sign in to ${cfg.label}.`, 'error')
      }
    },
    async disconnect() {
      clear(cfg.keySuffix)
      window.dispatchEvent(new Event('nexusmd:cloud-auth-changed'))
    },
    async getToken({ force } = {}) {
      const auth = read(cfg.keySuffix)
      if (!auth?.accessToken) return null
      if (!force) return auth.accessToken
      try {
        const t = await window.electronAPI.oauth.refresh(cfg.flow, auth.refreshToken)
        if (!t?.accessToken) return null
        write(cfg.keySuffix, { ...auth, accessToken: t.accessToken, refreshToken: t.refreshToken || auth.refreshToken })
        return t.accessToken
      } catch (e) {
        toast?.(e?.message ? `${cfg.label}: ${e.message}` : `Could not refresh ${cfg.label} sign-in.`, 'error')
        return null
      }
    },
  }
}

export const desktopCloudProviders = [
  makeGoogleDriveProvider(makeBinding('gdrive')),
  makeOneDriveProvider(makeBinding('onedrive')),
]
