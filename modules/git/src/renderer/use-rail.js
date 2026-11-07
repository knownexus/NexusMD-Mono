import React from 'react'
import { getGitConfig, setGitConfig } from './git-config.js'
import { useGitConfig } from './use-git-config.js'

// A tab kind's key in the saved view state.
const KEYS = { changes: 'changes', files: 'files', 'github-files': 'githubFiles' }

/**
 * Whether a tab's right-hand panel is open (it starts open) and a toggle that saves the choice.
 * Ctrl+] toggles it while the tab is shown, except over a dialog.
 */
export function useRail(kind) {
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
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  return { open, toggle }
}
