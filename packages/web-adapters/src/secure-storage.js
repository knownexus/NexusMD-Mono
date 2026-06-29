// secure-storage.js — factory for the WebCrypto+IndexedDB secure adapter shared by
// web, desktop, and app. A non-extractable AES-GCM master key lives in IndexedDB
// (structured-clone keeps it unexportable); only b64(iv‖ciphertext) is written to
// localStorage under `${encPrefix}${key}`. get() returns null on any failure.

// Chunked base64 of a byte array. Avoids `btoa(String.fromCharCode(...bytes))`,
// whose argument spread overflows the call stack for large buffers.
export function bytesToBase64(bytes) {
  let bin = ''
  const CHUNK = 0x8000 // 32 KiB — well under the per-call argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function createSecureStorageAdapter({ encPrefix, dbName, storeName = 'keys', keyId = 'master' }) {
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName)
      req.onsuccess = (e) => resolve(e.target.result)
      req.onerror   = (e) => reject(e.target.error)
    })
  }

  // Reads the master key, generating one on first use. generateKey() runs OUTSIDE
  // any IndexedDB transaction — an IDB tx auto-commits once control returns to the
  // event loop, so awaiting crypto mid-transaction is not spec-safe. The commit step
  // re-reads inside one synchronous readwrite tx (get→put with no await between, so
  // the tx stays active), making first-use concurrent callers converge on a single
  // key: the first writer wins, later callers adopt the stored key and discard theirs.
  async function getKey() {
    const db = await openDb()
    const idbGet = (mode) => new Promise((resolve, reject) => {
      const get = db.transaction(storeName, mode).objectStore(storeName).get(keyId)
      get.onsuccess = () => resolve(get.result || null)
      get.onerror   = (e) => reject(e.target.error)
    })

    const existing = await idbGet('readonly')
    if (existing) return existing

    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    )

    return new Promise((resolve, reject) => {
      const st  = db.transaction(storeName, 'readwrite').objectStore(storeName)
      const get = st.get(keyId)
      get.onsuccess = () => {
        if (get.result) { resolve(get.result); return } // another caller won the race
        const put = st.put(generated, keyId)
        put.onsuccess = () => resolve(generated)
        put.onerror   = (e) => reject(e.target.error)
      }
      get.onerror = (e) => reject(e.target.error)
    })
  }

  async function encrypt(key, text) {
    const iv  = crypto.getRandomValues(new Uint8Array(12))
    const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
    const buf = new Uint8Array(12 + ct.byteLength)
    buf.set(iv)
    buf.set(new Uint8Array(ct), 12)
    return bytesToBase64(buf)
  }

  async function decrypt(key, b64) {
    const buf = base64ToBytes(b64)
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
    return new TextDecoder().decode(pt)
  }

  return {
    async get(storageKey) {
      try {
        const raw = localStorage.getItem(encPrefix + storageKey)
        if (!raw) return null
        return await decrypt(await getKey(), raw)
      } catch { return null }
    },
    async set(storageKey, value) {
      try { localStorage.setItem(encPrefix + storageKey, await encrypt(await getKey(), value)) }
      catch { /* ignore */ }
    },
    async remove(storageKey) {
      try { localStorage.removeItem(encPrefix + storageKey) } catch { /* ignore */ }
    },
  }
}
