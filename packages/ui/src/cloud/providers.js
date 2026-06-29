// Shared cloud-provider factories for profile bundles. Platform-agnostic file
// operations against a user-visible /NexusMD folder; the only injected piece is
// the platform authBinding ({ isConnected, connect, disconnect, getToken }).
const FOLDER = 'NexusMD'

// Run an authorized fetch; on 401 refresh the token once and retry.
async function authedFetch(authBinding, url, opts = {}) {
  const run = async (token) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  let token = await authBinding.getToken()
  let res = await run(token)
  if (res.status === 401) {
    token = await authBinding.getToken({ force: true })
    res = await run(token)
  }
  if (!res.ok) throw new Error(`cloud request failed (${res.status})`)
  return res
}

export function makeGoogleDriveProvider(authBinding) {
  let folderId = null

  async function ensureFolder() {
    if (folderId) return folderId
    const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
    const found = await (await authedFetch(authBinding,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).json()
    if (found.files && found.files.length) { folderId = found.files[0].id; return folderId }
    const created = await (await authedFetch(authBinding,
      'https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
      })).json()
    folderId = created.id
    return folderId
  }

  async function findFileByName(name) {
    const fid = await ensureFolder()
    const q = encodeURIComponent(`'${fid}' in parents and name='${name}' and trashed=false`)
    const r = await (await authedFetch(authBinding,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).json()
    return r.files && r.files.length ? r.files[0].id : null
  }

  return {
    id: 'gdrive',
    label: 'Google Drive',
    isConnected: authBinding.isConnected,
    connect: authBinding.connect,
    disconnect: authBinding.disconnect,

    async list() {
      const fid = await ensureFolder()
      const q = encodeURIComponent(`'${fid}' in parents and trashed=false`)
      const r = await (await authedFetch(authBinding,
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc`)).json()
      return (r.files || [])
        .filter(f => f.name.endsWith('.nmdprofile'))
        .map(f => ({ id: f.id, name: f.name, modifiedAt: f.modifiedTime }))
    },

    async upload(name, text) {
      const fid = await ensureFolder()
      const existing = await findFileByName(name)
      if (existing) {
        await authedFetch(authBinding,
          `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`, {
            method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: text,
          })
        return
      }
      const boundary = 'nmd-' + Math.random().toString(36).slice(2)
      const metadata = JSON.stringify({ name, parents: [fid] })
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--`
      await authedFetch(authBinding,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        })
    },

    async download(id) {
      const r = await authedFetch(authBinding,
        `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
      return r.text()
    },
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive'

export function makeOneDriveProvider(authBinding) {
  return {
    id: 'onedrive',
    label: 'OneDrive',
    isConnected: authBinding.isConnected,
    connect: authBinding.connect,
    disconnect: authBinding.disconnect,

    async list() {
      // Path addressing auto-no-ops if folder is absent → treat 404 as empty.
      let res
      try {
        res = await authedFetch(authBinding,
          `${GRAPH}/root:/${FOLDER}:/children?$select=id,name,lastModifiedDateTime`)
      } catch (e) {
        if (String(e.message).includes('(404)')) return []
        throw e
      }
      const r = await res.json()
      return (r.value || [])
        .filter(f => f.name.endsWith('.nmdprofile'))
        .map(f => ({ id: f.id, name: f.name, modifiedAt: f.lastModifiedDateTime }))
    },

    async upload(name, text) {
      // PUT to a path creates the file and any missing parent folders.
      await authedFetch(authBinding,
        `${GRAPH}/root:/${FOLDER}/${encodeURIComponent(name)}:/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        })
    },

    async download(id) {
      const r = await authedFetch(authBinding, `${GRAPH}/items/${id}/content`)
      return r.text()
    },
  }
}
