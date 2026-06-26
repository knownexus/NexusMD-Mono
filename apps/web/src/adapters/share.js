export const shareAdapter = {
  async share(title, text, url) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return } catch { /* fall through */ }
    }
    try { await navigator.clipboard.writeText([title, text, url].filter(Boolean).join('\n')) } catch { /* ignore */ }
  },
  isAvailable() {
    return !!(navigator.share || navigator.clipboard)
  },
}
