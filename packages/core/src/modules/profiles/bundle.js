// bundle.js — portable, password-encrypted profile bundle (one or many profiles).
// Pure + headless: Web Crypto via the shared AES-GCM helpers. The on-disk text is
// always the encrypted wrapper; the decrypted payload is cross-app readable.
import { encryptConfidentialForServer, decryptConfidentialFromServer } from '../planner/confidential.js'

export const BUNDLE_FORMAT     = 'nexusmd-profile-bundle'
export const BUNDLE_FORMAT_ENC = 'nexusmd-profile-bundle-enc'
export const BUNDLE_VERSION    = 1
export const BUNDLE_EXT        = '.nmdprofile'

// SHA-256(password + bundle salt) as lowercase hex → AES-256-GCM key material.
// Distinct salt from the planner-confidential hash so the keyspaces don't overlap.
async function bundleKeyHash(password) {
  const data = new TextEncoder().encode(password + ' nexusmd-profile-bundle')
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function encodeBundle(payload, password) {
  if (!password) throw new Error('A password is required.')
  const body = { ...payload, format: BUNDLE_FORMAT, version: BUNDLE_VERSION }
  const hash = await bundleKeyHash(password)
  const { iv, ciphertext } = await encryptConfidentialForServer(body, hash)
  return JSON.stringify({ format: BUNDLE_FORMAT_ENC, version: BUNDLE_VERSION, iv, ciphertext }, null, 2)
}

export async function decodeBundle(text, password) {
  let wrapper
  try { wrapper = JSON.parse(text) } catch { throw new Error('Not a NexusMD profile file.') }
  if (!wrapper || wrapper.format !== BUNDLE_FORMAT_ENC || !wrapper.iv || !wrapper.ciphertext) {
    throw new Error('Not a NexusMD profile file.')
  }
  const hash = await bundleKeyHash(password)
  let payload
  try { payload = await decryptConfidentialFromServer({ iv: wrapper.iv, ciphertext: wrapper.ciphertext }, hash) }
  catch { throw new Error('Wrong password or corrupted file.') }
  if (!payload || payload.format !== BUNDLE_FORMAT || !Array.isArray(payload.profiles)) {
    throw new Error('Wrong password or corrupted file.')
  }
  return payload
}
