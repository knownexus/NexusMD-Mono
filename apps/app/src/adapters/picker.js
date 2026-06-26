function pickFileViaInput(filter) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (filter?.ext) input.accept = filter.ext

    // Android WebView often doesn't fire oncancel — guard with focus-return timeout
    let settled = false
    const settle = (v) => { if (!settled) { settled = true; resolve(v) } }
    const onFocus = () => { setTimeout(() => settle(null), 500) }

    input.onchange = async () => {
      window.removeEventListener('focus', onFocus)
      const file = input.files?.[0]
      if (!file) { settle(null); return }
      try {
        const text = await file.text()
        settle({ path: null, name: file.name, text })
      } catch (e) { if (!settled) { settled = true; reject(e) } }
    }
    input.oncancel = () => { window.removeEventListener('focus', onFocus); settle(null) }

    // When the picker closes without selection the window regains focus
    window.addEventListener('focus', onFocus, { once: true })
    input.click()
  })
}

export const pickerAdapter = {
  async pickFile(filter) {
    return pickFileViaInput(filter)
  },
  async pickDirectory() {
    return null  // directory picker needs Capacitor plugin on Android
  },
  async saveFile(name, text) {
    const blob = new Blob([text], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
}
