// planner-confidential.js — persistence wrappers for the planner's confidential
// section config. Shared web + app. The pure AES-GCM crypto lives in
// @nexusmd/core (hashPassword / encrypt / decrypt); here we add the two helpers
// that touch storage + the per-platform pref-sync, namespaced via the planner
// runtime (web 'nexusmd', app 'helm') exactly like loadGlobalNotes/saveGlobalNotes.
import {
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
} from '@nexusmd/core'
import { getPlannerRuntime } from './runtime.js'

// Re-export the core crypto so callers get the whole confidential surface from
// one module (web's confidential.jsx stub + the app planner both import here).
export { hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer }

function confidentialKey() {
  const { getProfileKey, namespace } = getPlannerRuntime()
  return getProfileKey(`${namespace}.planner.confidential`)
}

export function loadConfidentialConfig() {
  const { storage } = getPlannerRuntime()
  try {
    return JSON.parse(storage.getItem(confidentialKey()) || '{"sections":[],"hash":null}')
  } catch {
    return { sections: [], hash: null }
  }
}

export function saveConfidentialConfig(cfg) {
  const { storage, namespace, pushPref } = getPlannerRuntime()
  try { storage.setItem(confidentialKey(), JSON.stringify(cfg)) } catch {}
  if (cfg.hash) {
    (async () => {
      try {
        const encrypted = await encryptConfidentialForServer(cfg, cfg.hash)
        pushPref?.(`${namespace}.planner.confidential`, JSON.stringify(encrypted))
      } catch (_) {}
    })()
  }
}
