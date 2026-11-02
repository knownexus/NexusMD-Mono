// Build artifacts are downloaded and saved by the main process (artifacts:save): it shows the save
// dialog, builds the provider's auth header itself and sends it only to that provider's API host.
// The caller passes the artifact item and that provider's token ({ pat }, plus { org } for Azure DevOps).
const api = () => window.electronAPI

// ipcRenderer.invoke wraps a thrown error as "Error invoking remote method '…': Error: <message>".
const plainMessage = (e) => String(e?.message || e || 'Download failed.').replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

export const artifactsAdapter = {
  available() { return typeof api()?.artifacts?.save === 'function' },
  // -> { saved: false } | { saved: true, path, bytes }
  async saveArtifact(item, credentials) {
    let r
    try {
      r = await api().artifacts.save(item, credentials)
    } catch (e) {
      throw new Error(plainMessage(e))
    }
    return r?.saved ? { saved: true, path: r.path, bytes: r.bytes } : { saved: false }
  },
}
