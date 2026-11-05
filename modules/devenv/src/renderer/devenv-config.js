// Where devenv lives and how to run it, per NexusMD profile.
import { getProfileKey } from '@nexusmd/shell-sdk'
import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('devenv', 'config')

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
  try { localStorage.setItem(KEY(), JSON.stringify(next)) } catch (err) { ignore(log, 'the devenv config could not be saved (storage full or blocked)', err, 'warn') }
  window.dispatchEvent(new Event('nexusmd:devenv-config'))
  return next
}
