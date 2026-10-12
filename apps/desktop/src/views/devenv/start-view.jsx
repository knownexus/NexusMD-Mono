import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { RunPanel } from './run-panel.jsx'
import { SummaryCard } from './summary-card.jsx'

const LABEL = 'devenv start'

// The plan itself is a dialog (devenv asks for it once the sources are resolved), so this
// tab only launches the run and shows where it got to.
export function StartView() {
  const run = useDevenvRunContext()
  const [remote, setRemote] = React.useState(false)
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const mine = run.state.command === LABEL && run.state.status !== 'idle'
  const summary = mine ? [...run.state.results].reverse().find(r => r.kind === 'summary') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div>Review the plan, then build and start the session.</div>
      <label style={{ display: 'flex', gap: 8 }}>
        <input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} aria-label="Use the remote DEV database" />
        <span>Use the remote DEV database (shared — changes are real)</span>
      </label>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy}
        onClick={() => run.start(remote ? ['start', '--remote-db'] : ['start'], { exclusive: true, label: LABEL })}>Start session…</button>
      {summary && <SummaryCard result={summary} />}
      {mine && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
