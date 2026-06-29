// Web file I/O for profile bundles: download to save, hidden <input> to open.
export const webFileIO = {
  async saveFile(filename, text) {
    if (window.nexusMDDownload) { await window.nexusMDDownload(filename, text); return }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
  pickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.nmdprofile,.nmdplanner,application/json'
      input.onchange = () => {
        const f = input.files?.[0]
        if (!f) { resolve(null); return }
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => resolve(null)
        r.readAsText(f)
      }
      input.click()
    })
  },
}
