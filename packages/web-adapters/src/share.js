import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('core', 'share')

export const shareAdapter = {
  async share(title, text, url) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return } catch (err) { ignore(log, 'sharing was cancelled or is not possible, so the text is copied instead', err) }
    }
    try { await navigator.clipboard.writeText([title, text, url].filter(Boolean).join('\n')) } catch (err) { ignore(log, 'the clipboard refused the write', err) }
  },
  isAvailable() {
    return !!(navigator.share || navigator.clipboard)
  },
}
