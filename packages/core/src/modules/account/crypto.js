/**
 * Account crypto primitives (WebCrypto only).
 *
 * Password -> PBKDF2-HMAC-SHA256 (64 bytes) -> HKDF split into:
 *   - authKey  (32 bytes, base64, HKDF info "nexusmd-auth"): sent to the server
 *   - vaultKey (AES-GCM-256, HKDF info "nexusmd-vault"): never leaves the client
 *
 * A ContainerKey is an opaque handle: 32 random bytes plus an HKDF-derived
 * AES-GCM key (`enc`) for content and an HMAC key (`id`) for opaque identifiers.
 * All base64 values are standard base64 (opaqueId uses base64url).
 */

export const MIN_ITERATIONS = 600000

const SALT_BYTES = 16
const IV_BYTES = 12
const CK_BYTES = 32
const AUTH_INFO = 'nexusmd-auth'
const VAULT_INFO = 'nexusmd-vault'
const CK_ENC_INFO = 'nexusmd-ck-enc'
const CK_ID_INFO = 'nexusmd-ck-id'
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

const enc = new TextEncoder()
const dec = new TextDecoder()

function subtle() {
  return globalThis.crypto.subtle
}

function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function toB64Url(bytes) {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

/** HKDF-SHA256 over `ikm` with an empty salt and a domain-separating `info`. */
async function hkdfBits(ikm, info, bits) {
  const base = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const out = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    bits,
  )
  return new Uint8Array(out)
}

/** AES-GCM encrypt; returns iv || ciphertext+tag. */
async function aesSeal(key, plain) {
  const iv = randomBytes(IV_BYTES)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return out
}

/** Inverse of aesSeal; throws on wrong key or tampering. */
async function aesOpen(key, sealed) {
  if (sealed.length <= IV_BYTES) throw new Error('Ciphertext too short')
  const iv = sealed.subarray(0, IV_BYTES)
  const ct = sealed.subarray(IV_BYTES)
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct))
}

/** @returns {string} 16 random bytes, base64 */
export function randomSalt() {
  return toB64(randomBytes(SALT_BYTES))
}

/**
 * Derive the server auth key and the local vault key from a password.
 * @param {string} password
 * @param {string} saltB64
 * @param {number} iterations PBKDF2 iteration count
 * @returns {Promise<{ authKey: string, vaultKey: CryptoKey }>}
 */
export async function deriveKeys(password, saltB64, iterations) {
  const pwKey = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const master = new Uint8Array(await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    pwKey,
    512,
  ))
  const authBytes = await hkdfBits(master, AUTH_INFO, 256)
  const vaultBytes = await hkdfBits(master, VAULT_INFO, 256)
  const vaultKey = await subtle().importKey('raw', vaultBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { authKey: toB64(authBytes), vaultKey }
}

async function buildContainerKey(raw) {
  const encBytes = await hkdfBits(raw, CK_ENC_INFO, 256)
  const idBytes = await hkdfBits(raw, CK_ID_INFO, 256)
  const encKey = await subtle().importKey('raw', encBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const idKey = await subtle().importKey('raw', idBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return { raw, enc: encKey, id: idKey }
}

/** @returns {Promise<object>} opaque ContainerKey handle */
export async function generateContainerKey() {
  return buildContainerKey(randomBytes(CK_BYTES))
}

/** @returns {string} base64 of the 32 raw container key bytes */
export function exportContainerKey(ck) {
  return toB64(ck.raw)
}

/** @param {string} b64 */
export async function importContainerKey(b64) {
  const raw = fromB64(b64)
  if (raw.length !== CK_BYTES) throw new Error('Invalid container key')
  return buildContainerKey(raw)
}

/** Wrap a container key under the vault key. @returns {Promise<string>} base64 iv||ct */
export async function wrapContainerKey(ck, vaultKey) {
  return toB64(await aesSeal(vaultKey, ck.raw))
}

/** Unwrap a container key; rejects with a wrong vault key or tampered data. */
export async function unwrapContainerKey(wrapped, vaultKey) {
  const raw = await aesOpen(vaultKey, fromB64(wrapped))
  if (raw.length !== CK_BYTES) throw new Error('Invalid container key')
  return buildContainerKey(raw)
}

/** @returns {Promise<string>} base64 iv||ct of the JSON-serialised value */
export async function encryptJson(value, ck) {
  return toB64(await aesSeal(ck.enc, enc.encode(JSON.stringify(value))))
}

/** Rejects on tampering or a wrong key. */
export async function decryptJson(blob, ck) {
  return JSON.parse(dec.decode(await aesOpen(ck.enc, fromB64(blob))))
}

/** Deterministic, name-hiding identifier: HMAC-SHA256(name), base64url. */
export async function opaqueId(name, ck) {
  const mac = await subtle().sign('HMAC', ck.id, enc.encode(name))
  return toB64Url(new Uint8Array(mac))
}

/**
 * Generate an ECDH P-256 key pair.
 * @returns {Promise<{ publicKey: string, privateKey: CryptoKey }>} publicKey is spki base64
 */
export async function generateKeyPair() {
  const pair = await subtle().generateKey(ECDH, true, ['deriveBits'])
  const spki = await subtle().exportKey('spki', pair.publicKey)
  return { publicKey: toB64(new Uint8Array(spki)), privateKey: pair.privateKey }
}

/** Wrap the private key (PKCS8) under the vault key. @returns {Promise<string>} base64 iv||ct */
export async function wrapPrivateKey(privateKey, vaultKey) {
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', privateKey))
  return toB64(await aesSeal(vaultKey, pkcs8))
}

/** Unwrap a private key. The result is extractable so it can be re-wrapped on password change. */
export async function unwrapPrivateKey(wrapped, vaultKey) {
  const pkcs8 = await aesOpen(vaultKey, fromB64(wrapped))
  return subtle().importKey('pkcs8', pkcs8, ECDH, true, ['deriveBits'])
}
