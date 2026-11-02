import React from 'react'
import { useAccount } from '@nexusmd/ui'

// Account sync stamps the time of a local edit when it first observes it, so last-writer-wins needs an
// observe() soon after settings change. The gate owns start()/stop(). `sync` is null when the user
// opted out. The pagehide observe is best-effort only (it is async and queued behind a running sync),
// so Settings also observes on tab change and on leaving, which is where most edits are made.
export function useObserveForSync(tweaks) {
  const { sync } = useAccount()
  React.useEffect(() => { sync?.observe() }, [sync, tweaks])
  React.useEffect(() => {
    if (!sync) return undefined
    const onHide = () => { sync.observe() }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [sync])
}

// For the Settings screen: observe when the tab changes and when Settings is left.
export function useObserveOnSettingsChange(tab) {
  const { sync } = useAccount()
  const ref = React.useRef(sync)
  ref.current = sync
  React.useEffect(() => () => { ref.current?.observe() }, [tab])
}
