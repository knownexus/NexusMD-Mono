async function readFileHandle(handle) {
  const file = await handle.getFile()
  const text = await file.text()
  return { path: null, name: file.name, text }
}

export const pickerAdapter = {
  async pickFile(filter) {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: filter?.ext
            ? [{ description: 'Files', accept: { 'application/octet-stream': [filter.ext] } }]
            : undefined,
          multiple: false,
        })
        return readFileHandle(handle)
      } catch (e) {
        if (e.name === 'AbortError') return null
        throw e
      }
    }
    // Legacy fallback
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      if (filter?.ext) input.accept = filter.ext
      let settled = false
      const settle = (v) => { if (!settled) { settled = true; resolve(v) } }
      const onFocus = () => setTimeout(() => settle(null), 500)
      input.onchange = async () => {
        window.removeEventListener('focus', onFocus)
        const file = input.files?.[0]
        if (!file) { settle(null); return }
        try { settle({ path: null, name: file.name, text: await file.text() }) }
        catch (e) { if (!settled) { settled = true; reject(e) } }
      }
      input.oncancel = () => { window.removeEventListener('focus', onFocus); settle(null) }
      window.addEventListener('focus', onFocus, { once: true })
      input.click()
    })
  },

  async pickDirectory() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker()
        return handle.name
      } catch (e) {
        if (e.name === 'AbortError') return null
        throw e
      }
    }
    return null
  },

  async saveFile(name, text) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name })
        const writable = await handle.createWritable()
        await writable.write(text)
        await writable.close()
        return
      } catch (e) {
        if (e.name !== 'AbortError') throw e
        return
      }
    }
    // Legacy fallback
    const blob = new Blob([text], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
}
