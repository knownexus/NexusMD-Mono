import React from 'react'

const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

/**
 * Git Workspace keys. handlers (all optional):
 *   jumpToBranch (Ctrl/⌘K), goToFile (Ctrl/⌘P), focusFilter (/), focusCommand (`),
 *   next (j), previous (k), stage (s), unstage (u), newBranch (b)
 * Letter and symbol keys are ignored while typing or while a dialog is open; Ctrl/⌘ keys always work.
 * Keep the existing s/u/c handling inside ChangesPane — these are page-level fallbacks.
 */
export function useGitShortcuts(handlers, enabled = true) {
  const ref = React.useRef(handlers)
  ref.current = handlers
  React.useEffect(() => {
    if (!enabled) return undefined
    const onKey = e => {
      const h = ref.current
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (mod && !e.altKey && !e.shiftKey) {
        if (key === 'k' && h.jumpToBranch) { e.preventDefault(); h.jumpToBranch(); return }
        if (key === 'p' && h.goToFile) { e.preventDefault(); h.goToFile(); return }
        return
      }
      if (e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return
      const map = { '/': h.focusFilter, '`': h.focusCommand, j: h.next, k: h.previous, s: h.stage, u: h.unstage, b: h.newBranch }
      const fn = map[key]
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
