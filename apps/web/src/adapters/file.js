const BASE = '/api/files'

async function api(method, endpoint, body) {
  const opts = { method }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'text/plain' }
    opts.body = body
  }
  return fetch(`${BASE}${endpoint}`, opts)
}

export const fileAdapter = {
  async defaultProfileDir() {
    const r = await api('GET', '/default-dir')
    if (!r.ok) return ''
    const j = await r.json()
    return j.path
  },
  async read(path) {
    const r = await api('GET', `/content?path=${encodeURIComponent(path)}`)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`fileAdapter.read failed: ${r.status}`)
    return r.text()
  },
  async write(path, content) {
    const r = await api('POST', `/content?path=${encodeURIComponent(path)}`, content)
    if (!r.ok) throw new Error(`fileAdapter.write failed: ${r.status}`)
  },
  async exists(path) {
    const r = await api('GET', `/exists?path=${encodeURIComponent(path)}`)
    if (!r.ok) return false
    const j = await r.json()
    return j.exists
  },
  async list(dir) {
    const r = await api('GET', `/list?dir=${encodeURIComponent(dir)}`)
    if (!r.ok) return []
    return r.json()
  },
  async delete(path) {
    await api('DELETE', `/content?path=${encodeURIComponent(path)}`)
  },
  async mkdir(dir) {
    await api('POST', `/dir?path=${encodeURIComponent(dir)}`)
  },
}
