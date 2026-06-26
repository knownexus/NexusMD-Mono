export const shareAdapter = {
  async share(title, text, url) {
    const content = [title, text, url].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(content) } catch { /* ignore */ }
  },
  isAvailable() { return !!(navigator.clipboard) },
}
