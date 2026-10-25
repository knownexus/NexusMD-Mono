// Where devenv lives and how to run it, per NexusMD profile.
import { getProfileKey } from '@nexusmd/shell-sdk'

const KEY = () => getProfileKey('devenv.config')

export const DEFAULT_DEVENV_CONFIG = Object.freeze({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })

export function getDevenvConfig() {
  try {
    const raw = localStorage.getItem(KEY())
    const saved = raw ? JSON.parse(raw) : {}
    return { ...DEFAULT_DEVENV_CONFIG, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULT_DEVENV_CONFIG }
  }
}

export function setDevenvConfig(patch) {
  const next = { ...getDevenvConfig(), ...patch }
  try { localStorage.setItem(KEY(), JSON.stringify(next)) } catch {}
  window.dispatchEvent(new Event('nexusmd:devenv-config'))
  return next
}
