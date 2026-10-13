import React from 'react'
import { pickerAdapter } from '../../adapters/picker.js'
import { CommandsView } from './commands-view.jsx'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { getProfileKey } from '../../profile-keys.js'
import { StatusView } from './status-view.jsx'
import { StartView } from './start-view.jsx'
import { BuildsView } from './builds-view.jsx'

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

const TABS = ['Status', 'Start', 'Builds', 'Logs', 'Commands']
const tabKey = () => getProfileKey('devenv.tab')

function useTab() {
  const [tab, setTab] = React.useState(() => {
    try { const t = localStorage.getItem(tabKey()); return TABS.includes(t) ? t : 'Status' } catch { return 'Status' }
  })
  const choose = t => { setTab(t); try { localStorage.setItem(tabKey(), t) } catch {} }
  return [tab, choose]
}

// Tests, Database, Emulator, Mac and Profile tabs join these in later phases
// (docs/superpowers/specs/2026-10-08-devenv-module-design.md).
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  const run = useDevenvRunContext()
  const [tab, setTab] = useTab()
  if (!adapter?.isAvailable() || !run) return <div style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Dev Environment</h2>
      <LeftoverRunsBanner leftover={run.leftover} />
      <div style={{ display: 'flex', gap: 6 }}>
        {TABS.map(t => (
          <button key={t} className={`btn sm ${tab === t ? '' : 'ghost'}`} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Status' && <StatusView adapter={adapter} onStart={() => setTab('Start')} />}
      {tab === 'Start' && <StartView />}
      {tab === 'Builds' && <BuildsView adapter={adapter} />}
      {tab === 'Logs' && null}
      {tab === 'Commands' &&<CommandsView adapter={adapter} picker={pickerAdapter} />}
    </div>
  )
}
