import React from 'react'
import { normaliseCatalog, isCompatibleCatalog, buildDevenvArgv, takesArgs, takesManyArgs } from '@nexusmd/core'
import { getDevenvConfig } from '../../devenv-config.js'
import { useDevenvRun } from './use-devenv-run.js'
import { RunPanel } from './run-panel.jsx'
import { PromptDialog } from './prompt-dialog.jsx'

const fieldStyle = { width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

function useDevenvConfig() {
  const [cfg, setCfg] = React.useState(getDevenvConfig)
  React.useEffect(() => {
    const onChange = () => setCfg(getDevenvConfig())
    window.addEventListener('nexusmd:devenv-config', onChange)
    return () => window.removeEventListener('nexusmd:devenv-config', onChange)
  }, [])
  return cfg
}

function CommandForm({ command, picker, onRun, disabled }) {
  const [positional, setPositional] = React.useState([''])
  const [switches, setSwitches] = React.useState({})
  const [values, setValues] = React.useState({})
  React.useEffect(() => { setPositional(['']); setSwitches({}); setValues({}) }, [command.key])

  const pick = async kind => {
    try { return await (kind === 'folder' ? picker.pickDirectory?.() : picker.pickFile?.()) } catch { return null }
  }
  const setArg = (i, v) => setPositional(p => p.map((x, j) => (j === i ? v : x)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><strong>{`devenv ${command.key}`}</strong> <span style={{ color: 'var(--text-muted)' }}>{command.args}</span></div>
      <div style={{ color: 'var(--text-muted)' }}>{command.summary}</div>
      {takesArgs(command) && positional.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <input aria-label={`Argument ${i + 1}`} value={v} onChange={e => setArg(i, e.target.value)} style={fieldStyle} />
          {command.pathArgs && (
            <button className="btn sm ghost" onClick={async () => { const p = await pick(command.pathArgs === 'folder' ? 'folder' : 'file'); if (p) setArg(i, p) }}>Browse…</button>
          )}
        </div>
      ))}
      {takesManyArgs(command) && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPositional(p => [...p, ''])}>+ Add another</button>
      )}
      {command.switches.map(s => (
        <label key={s} style={{ display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={!!switches[s]} onChange={e => setSwitches(x => ({ ...x, [s]: e.target.checked }))} />
          <span>{`--${s}`}</span>
        </label>
      ))}
      {command.values.map(name => (
        <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 110 }}>{`--${name}`}</span>
          <input aria-label={`--${name}`} value={values[name] || ''} onChange={e => setValues(x => ({ ...x, [name]: e.target.value }))} style={fieldStyle} />
          {command.pathValues[name] && (
            <button className="btn sm ghost" onClick={async () => { const p = await pick(command.pathValues[name]); if (p) setValues(x => ({ ...x, [name]: p })) }}>Browse…</button>
          )}
        </div>
      ))}
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={disabled}
        onClick={() => onRun(buildDevenvArgv(command, { positional, switches, values }))}>Run</button>
    </div>
  )
}

export function CommandsView({ adapter, picker, notify }) {
  const config = useDevenvConfig()
  const [catalog, setCatalog] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [filter, setFilter] = React.useState('')
  const [selected, setSelected] = React.useState(null)
  const run = useDevenvRun({ adapter, config, notify })

  React.useEffect(() => {
    let live = true
    setCatalog(null); setError(null)
    adapter.catalog(config)
      .then(r => { if (live) setCatalog(normaliseCatalog(r)) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [adapter, config])

  if (error) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ color: 'var(--danger)' }}>{error}</div>
        <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>Check the devenv folder in Settings → Desktop → Dev Environment.</div>
      </div>
    )
  }
  if (!catalog) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Asking devenv for its commands…</div>
  if (!isCompatibleCatalog(catalog)) {
    return <div className="card" style={{ padding: 16 }}>{`This devenv speaks protocol ${catalog.protocol}; NexusMD needs 1 - update devenv.`}</div>
  }

  const q = filter.trim().toLowerCase()
  const visible = catalog.commands.filter(c => !c.hidden && (!q || `${c.key} ${c.summary}`.toLowerCase().includes(q)))
  const command = visible.find(c => c.key === selected) || catalog.commands.find(c => c.key === selected) || null
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const prompt = run.state.prompts[0]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {catalog.profileError && <div style={{ color: 'var(--warning, #b8860b)' }}>{catalog.profileError}</div>}
        <input aria-label="Filter commands" placeholder="Filter commands" value={filter} onChange={e => setFilter(e.target.value)} style={fieldStyle} />
        <div style={{ overflow: 'auto' }}>
          {catalog.groups.map(g => {
            const rows = visible.filter(c => c.group === g.id)
            if (!rows.length) return null
            return (
              <div key={g.id || 'everyday'} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.title}</div>
                {rows.map(c => (
                  <button key={c.key} className={`btn ghost sm ${selected === c.key ? 'active' : ''}`}
                    style={{ display: 'block', width: '100%', textAlign: 'left' }} title={c.summary}
                    onClick={() => setSelected(c.key)}>{`devenv ${c.key}`}</button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {command
          ? <CommandForm command={command} picker={picker} disabled={busy && command.mut}
              onRun={argv => run.start(argv, { exclusive: command.mut, label: `devenv ${command.key}` })} />
          : <div style={{ color: 'var(--text-muted)' }}>Pick a command.</div>}
        {run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
      </div>
      {prompt && (
        <PromptDialog key={prompt.id} prompt={prompt}
          onAnswer={value => run.answer(prompt.id, value)}
          onCancel={() => run.cancelPrompt(prompt.id)} />
      )}
    </div>
  )
}
