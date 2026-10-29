import React from 'react'
import { core, makeGithubClient } from '@nexusmd/core'

// Work's GitHub, as Work offers it to other apps: null when Work isn't installed, GitHub isn't
// connected, or asking fails. Never throws, so Git Workspace renders as it always has.
function readGithub(host) {
  const caps = host?.capabilities
  try {
    if (!caps?.has?.('work.github')) return null
    const g = caps.call('work.github')
    return g && Array.isArray(g.repos) && g.repos.length ? g : null
  } catch {
    return null
  }
}

/**
 * `{ repos, client, cached, refreshKey } | null`. Read again whenever Work's data updates;
 * `refreshKey` goes up each time, for lists fetched live to fetch again.
 */
export function useGithub(host) {
  const [state, setState] = React.useState(() => ({ github: readGithub(host), refreshKey: 0 }))
  const readFor = React.useRef(host)
  React.useEffect(() => {
    let live = true
    let timer = null
    const read = () => { if (live) setState(s => ({ github: readGithub(host), refreshKey: s.refreshKey + 1 })) }
    // Work keeps its snapshot in React state, so it is read once Work has had the update too.
    // Work announces its refresh with no module id; core's per-module poll events carry one.
    const onData = payload => { if (payload?.moduleId) return; clearTimeout(timer); timer = setTimeout(read, 0) }
    // A different host from the one first read.
    if (readFor.current !== host) { readFor.current = host; setState(s => ({ ...s, github: readGithub(host) })) }
    core.on('data:updated', onData)
    return () => { live = false; clearTimeout(timer); core.off('data:updated', onData) }
  }, [host])
  const { github, refreshKey } = state
  const http = github?.http ?? null
  const client = React.useMemo(() => {
    try { return http ? makeGithubClient(http) : null } catch { return null }
  }, [http])
  return React.useMemo(() => (github ? { repos: github.repos, client, cached: github.cached ?? { prs: [], issues: [] }, refreshKey } : null),
    [github, client, refreshKey])
}
