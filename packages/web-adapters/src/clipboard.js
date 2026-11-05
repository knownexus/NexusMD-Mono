import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('core', 'clipboard')

export const clipboardAdapter = {
  async read() {
    try { return await navigator.clipboard.readText() } catch { return '' }
  },
  async write(text) {
    try { await navigator.clipboard.writeText(text) } catch (err) { ignore(log, 'the clipboard refused the write', err) }
  },
  isAvailable() {
    return !!(navigator.clipboard)
  },
}
