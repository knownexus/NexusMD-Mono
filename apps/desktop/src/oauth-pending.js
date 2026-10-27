// A sign-in the user started, so that a nexusmd://oauth link is only honoured when one is waiting.
// Without this, any web page could open a link carrying someone else's one-time code and sign the
// app into the wrong account. The nonce travels in the return link (the server hands the link back
// untouched after sign-in) and is checked, and used up, when the link comes back.
const KEY = 'nexusmd.oauth.pending'
export const PENDING_TTL_MS = 10 * 60 * 1000

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} }
}
function save(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* the sign-in just cannot complete */ }
}

// Starts a sign-in with `provider`; returns the return link to give the server.
export function beginSignIn(provider, now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  const all = load()
  for (const [p, entry] of Object.entries(all)) if (!entry || entry.expires <= now) delete all[p]
  all[provider] = { nonce, expires: now + PENDING_TTL_MS }
  save(all)
  return `nexusmd://oauth/${provider}?n=${nonce}`
}

// Whether `nonce` is the waiting sign-in with `provider`. It works once.
export function finishSignIn(provider, nonce, now = Date.now()) {
  const all = load()
  const entry = all[provider]
  if (!entry || !nonce) return false
  delete all[provider]
  save(all)
  return entry.nonce === nonce && entry.expires > now
}
