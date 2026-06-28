// confidential.js — password-derived AES-GCM crypto for the planner's
// confidential sections. Pure and headless: uses only Web Crypto (`crypto.subtle`,
// `crypto.getRandomValues`), `TextEncoder`/`TextDecoder`, and `btoa`/`atob` — all
// available in both the browser and Node's global scope. No DOM, storage, or React.
//
// The persistence wrappers (load/saveConfidentialConfig) stay in the app layer
// (@nexusmd/ui) because they touch localStorage + the per-platform pref-sync.

/**
 * SHA-256 hash of `password` (salted) returned as a lowercase hex string, used
 * both as the integrity check and as the raw AES key material. Falls back to a
 * base64 encoding if Web Crypto is unavailable.
 */
export async function hashPassword(password) {
  try {
    const data = new TextEncoder().encode(password + ' helm-planner')
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return btoa(unescape(encodeURIComponent(password)))
  }
}

/**
 * Encrypt a confidential config object with the AES-GCM key derived from
 * `passwordHash` (the hex string from hashPassword). Returns `{ iv, ciphertext }`
 * as hex + base64 strings, ready to ship to the server.
 */
export async function encryptConfidentialForServer(cfg, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(cfg))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  }
}

/**
 * Decrypt an `{ iv, ciphertext }` payload produced by encryptConfidentialForServer
 * using the AES-GCM key derived from `passwordHash`. Returns the parsed config.
 */
export async function decryptConfidentialFromServer(encrypted, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = new Uint8Array(encrypted.iv.match(/.{2}/g).map(h => parseInt(h, 16)))
  const ct = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0))
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(decrypted))
}
