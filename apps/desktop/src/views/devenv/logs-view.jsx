import React from 'react'
import { normaliseLogTargets, captureFolder, DEVENV_CAPTURE_SINCE } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvRun } from './use-devenv-run.js'
import { LogPanel } from './log-panel.jsx'

const ARGV = ['logs', 'targets', '--json']
const ACTIVE = ['starting', 'running']

// Logs run beside the provider's run (they only read), in this tab's own run. A follow never
// ends by itself, so it is stopped when another log is picked and when the tab is left.
export function LogsView({ adapter }) {
  const shared = useDevenvRunContext()
  const logs = useDevenvRun({ adapter, config: shared.config })
  const { data, error } = useDevenvQuery({
    adapter, config: shared.config, argv: ARGV, kind: 'log-targets', normalise: normaliseLogTargets, runStatus: shared.state.status,
  })
  const [selected, setSelected] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [since, setSince] = React.useState('2h')
  const [openError, setOpenError] = React.useState(null)

  const targets = data ? data.groups.flatMap(g => g.targets) : []
  const target = targets.find(t => t.id === selected) || targets[0]

  const activeRef = React.useRef(false)
  activeRef.current = ACTIVE.includes(logs.state.status)
  const cancelRef = React.useRef(logs.cancel)
  cancelRef.current = logs.cancel
  React.useEffect(() => () => { if (activeRef.current) cancelRef.current() }, [])

  // A second start while the first is still resolving its run id could not cancel it, leaking the process.
  const startingRef = React.useRef(false)
  const starting = logs.state.status === 'starting'
  const launch = async argv => {
    if (startingRef.current) return
    startingRef.current = true
    try {
      setOpenError(null)
      if (activeRef.current) await logs.cancel()
      await logs.start(argv, { exclusive: false, label: `devenv ${argv.join(' ')}` })
    } finally {
      startingRef.current = false
    }
  }
  const folder = captureFolder(logs.state.results)
  const openFolder = () => adapter.open({ path: folder }).catch(e => setOpenError(e?.message || 'Could not open the folder'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Log" value={target?.id || ''} onChange={e => setSelected(e.target.value)} disabled={!targets.length}>
          {data?.groups.map(g => (
            <optgroup key={g.id} label={g.label}>
              {g.targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn sm primary" disabled={!target || starting} onClick={() => launch(target.argv)}>Show</button>
        <input aria-label="Filter" placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="Since" value={since} onChange={e => setSince(e.target.value)}>
            {DEVENV_CAPTURE_SINCE.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn sm ghost" disabled={starting} onClick={() => launch(['logs', 'capture', '--since', since])}>Capture logs</button>
          {folder && <button className="btn sm" onClick={openFolder}>Open capture folder</button>}
        </span>
      </div>
      {openError && <div style={{ color: 'var(--danger)' }}>{openError}</div>}
      {logs.state.status !== 'idle' && <LogPanel state={logs.state} filter={filter} onStop={logs.cancel} />}
    </div>
  )
}
