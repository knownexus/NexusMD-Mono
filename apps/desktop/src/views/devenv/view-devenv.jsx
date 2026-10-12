import React from 'react'
import { pickerAdapter } from '../../adapters/picker.js'
import { CommandsView } from './commands-view.jsx'
import { useDevenvRunContext } from './devenv-run-context.jsx'

// A run started before the window reloaded can't be watched or answered any more (its
// output and any open question went to the old window), so the only safe offer is Cancel.
function LeftoverRunsBanner({ leftover }) {
  if (!leftover.runs.length) return null
  const labels = leftover.runs.map(r => r.label).join(', ')
  return (
    <div className="card" role="alert" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ flex: 1 }}>{`devenv is still running ${labels} from before the window reloaded`}</span>
      {leftover.error && <span style={{ color: 'var(--danger)' }}>{leftover.error}</span>}
      <button className="btn sm danger" onClick={leftover.cancelAll}>Cancel</button>
    </div>
  )
}

// Phase 1 has one tab; Status, Start, Builds, Logs, Tests, Database, Emulator, Mac and
// Profile join it in later phases (docs/superpowers/specs/2026-10-08-devenv-module-design.md).
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  const run = useDevenvRunContext()
  if (!adapter?.isAvailable() || !run) return <div style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Dev Environment</h2>
      <LeftoverRunsBanner leftover={run.leftover} />
      <CommandsView adapter={adapter} picker={pickerAdapter} />
    </div>
  )
}
