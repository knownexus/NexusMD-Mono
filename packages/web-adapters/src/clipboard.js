export const clipboardAdapter = {
  async read() {
    try { return await navigator.clipboard.readText() } catch { return '' }
  },
  async write(text) {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
  },
  isAvailable() {
    return !!(navigator.clipboard)
  },
}
