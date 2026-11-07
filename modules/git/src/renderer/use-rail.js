import React from 'react'
import { getGitConfig, setGitConfig } from './git-config.js'
import { useGitConfig } from './use-git-config.js'

// A tab kind's key in the saved view state.
const KEYS = { changes: 'changes', files: 'files', 'github-files': 'githubFiles' }

// Whether `el` is on screen: attached, with nothing hidden (display: none) at or above it.
export function shown(el) {
  if (!el || !el.isConnected) return false
  for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false
  return true
}

/**
 * Whether a tab's right-hand panel is open (it starts open) and a toggle that saves the choice.
 * Ctrl+] toggles it while the tab is shown, except over a dialog: `active` is false while another tab of the
 * workspace is up, and `rootRef` (the tab's own element) says whether the page holding it is hidden. Tabs that stay
 * mounted behind others must not answer for them.
 */
export function useRail(kind, { active = true, rootRef = null } = {}) {
  const key = KEYS[kind]
  const config = useGitConfig()
  const open = config.view.railOpen[key] !== false
  const toggle = React.useCallback(() => {
    const view = getGitConfig().view
    setGitConfig({ view: { ...view, railOpen: { ...view.railOpen, [key]: !view.railOpen[key] } } })
  }, [key])
  React.useEffect(() => {
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key !== ']') return
      if (!active || (rootRef && !shown(rootRef.current))) return
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, active, rootRef])
  return { open, toggle }
}
