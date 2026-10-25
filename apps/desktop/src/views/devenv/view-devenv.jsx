import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { DevenvDashboard } from './devenv-dashboard.jsx'
import '@nexusmd/editor-kit/devenv-git.css'

// A run started before the window reloaded can't be watched or answered any more (its
// output and any open question went to the old window), so the only safe offer is Cancel.
function LeftoverRunsBanner({ leftover }) {
  if (!leftover.runs.length) return null
  const labels = leftover.runs.map(r => r.label).join(', ')
  return (
    <div className="nx-alert" role="alert" style={{ margin: '16px 28px 0', flex: 'none' }}>
      <span style={{ flex: 1 }}>{`Still running from before the window reloaded: ${labels}`}</span>
      {leftover.error && <span style={{ color: 'var(--danger)' }}>{leftover.error}</span>}
      <button className="btn sm danger" onClick={leftover.cancelAll}>Cancel</button>
    </div>
  )
}

// The tabs from the spec (docs/superpowers/specs/2026-10-08-devenv-module-design.md) are now
// dashboard tiles; the detailed screens open from each tile.
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  const run = useDevenvRunContext()
  if (!adapter?.isAvailable() || !run) return <div className="nx-empty" style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <LeftoverRunsBanner leftover={run.leftover} />
      <DevenvDashboard adapter={adapter} />
    </div>
  )
}
