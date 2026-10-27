import React from 'react'
import { Icon } from '@nexusmd/ui'
import { linkAdapter } from '@nexusmd/shell-sdk'
import { useWork } from './work-context.js'

// Next to the screen's title in the top bar: seconds until the next automatic refresh, and a button
// to pause it.
export function WorkTopbar() {
  const { refreshPaused, setRefreshPaused, refreshLeft } = useWork()
  return (
    <>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
        {refreshPaused ? 'paused' : `${refreshLeft}s`}
      </span>
      <button className="btn sm ghost" title={refreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
        onClick={() => setRefreshPaused(p => !p)}>
        <Icon name={refreshPaused ? 'play' : 'pause'} size={12}/>
      </button>
    </>
  )
}

// Under the top bar: shown when a GitHub token (used for PR and build data) has expired.
export function WorkBanner() {
  const { githubExpired, dismissGithubExpired } = useWork()
  if (!githubExpired) return null
  return (
    <div style={{
      background: 'var(--warning-soft)', borderBottom: '1px solid var(--warning-border)',
      padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
      flexShrink: 0,
    }}>
      <Icon name="alert" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }}/>
      <span style={{ flex: 1, color: 'var(--warning-text)' }}>GitHub token expired — re-connect to restore PR and build data.</span>
      <button className="btn sm ghost" onClick={() => {
        if (linkAdapter.canOpenExternal()) linkAdapter.openExternal('nexusmd://github-oauth')
        dismissGithubExpired()
      }}>Re-connect</button>
      <button className="btn sm ghost" onClick={dismissGithubExpired}>
        <Icon name="x" size={12}/>
      </button>
    </div>
  )
}
