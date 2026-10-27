import React from 'react'

const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
// A dialog, the branch or file palette, or an open menu owns the keyboard while it's showing.
const overlayOpen = () => !!document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"]')

/**
 * Git Workspace keys. handlers (all optional):
 *   jumpToBranch (Ctrl/⌘K), goToFile (Ctrl/⌘P), focusFilter (/), focusCommand (`),
 *   next (j), previous (k), stage (s), unstage (u), newBranch (b)
 * Letter and symbol keys are ignored while typing (inputs, textareas, CodeMirror), with Ctrl/⌘/Alt held
 * (Shift too, for letters) or while a dialog or menu is open; Ctrl/⌘ keys work anywhere but over a dialog.
 * Digits are left to the app shell's navigation. Keep the existing s/u/c handling inside ChangesPane —
 * these are page-level fallbacks.
 */
export function useGitShortcuts(handlers, enabled = true) {
  const ref = React.useRef(handlers)
  ref.current = handlers
  React.useEffect(() => {
    if (!enabled) return undefined
    const onKey = e => {
      if (e.defaultPrevented || e.isComposing) return
      const h = ref.current
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (mod && !e.altKey && !e.shiftKey) {
        const fn = key === 'k' ? h.jumpToBranch : key === 'p' ? h.goToFile : null
        if (!fn) return
        // preventDefault keeps the print dialog (Ctrl+P) away even when nothing opens.
        e.preventDefault()
        if (!overlayOpen()) fn()
        return
      }
      if (mod || e.altKey || (e.shiftKey && /^[a-z]$/.test(key)) || typing(e.target) || overlayOpen()) return
      const map = { '/': h.focusFilter, '`': h.focusCommand, j: h.next, k: h.previous, s: h.stage, u: h.unstage, b: h.newBranch }
      const fn = Object.hasOwn(map, key) ? map[key] : null
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
