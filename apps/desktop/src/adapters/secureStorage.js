const ENC_PREFIX = 'nexusmd.sec.'
const DB_NAME    = 'nexusmd-keystore'
const STORE_NAME = 'keys'
const KEY_ID     = 'master'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME)
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function getKey() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const st  = tx.objectStore(STORE_NAME)
    const get = st.get(KEY_ID)
    get.onsuccess = async () => {
      if (get.result) { resolve(get.result); return }
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
      )
      const put = st.put(key, KEY_ID)
      put.onsuccess = () => resolve(key)
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
  return btoa(String.fromCharCode(...buf))
}

async function decrypt(key, b64) {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12))
  return new TextDecoder().decode(pt)
}

export const secureStorageAdapter = {
  async get(storageKey) {
    try {
      const raw = localStorage.getItem(ENC_PREFIX + storageKey)
      if (!raw) return null
      return await decrypt(await getKey(), raw)
    } catch { return null }
  },
  async set(storageKey, value) {
    try { localStorage.setItem(ENC_PREFIX + storageKey, await encrypt(await getKey(), value)) }
    catch { /* ignore */ }
  },
  async remove(storageKey) {
    try { localStorage.removeItem(ENC_PREFIX + storageKey) } catch { /* ignore */ }
  },
}
