import React from 'react'
import { setIn, addRepository, renameRepository, removeRepository, REPOSITORY_KEY } from '@nexusmd/core'

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)' }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }
const asPort = v => (v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)
const badName = name => `"${name}" can't be used - lower-case letters, digits and -, not already taken.`

function Field({ label, aria, value, onChange }) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <input aria-label={aria} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function Check({ label, aria, checked, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" aria-label={aria} checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

// Draft text so a trailing comma survives while typing; the array is committed on blur or Enter.
function DatabasesField({ databases, onCommit }) {
  const joined = databases.join(', ')
  const [draft, setDraft] = React.useState(joined)
  React.useEffect(() => { setDraft(joined) }, [joined])
  const commit = () => onCommit(draft.trim() ? draft.split(',').map(s => s.trim()).filter(Boolean) : undefined)
  return (
    <label style={labelStyle}>
      <span>Databases (comma-separated)</span>
      <input aria-label="Databases" style={inputStyle} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
    </label>
  )
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

function RepositoryName({ name, taken, onRename }) {
  const [draft, setDraft] = React.useState(name)
  const [problem, setProblem] = React.useState(null)
  React.useEffect(() => { setDraft(name); setProblem(null) }, [name])
  const commit = () => {
    if (draft === name) return
    if (!REPOSITORY_KEY.test(draft) || taken.includes(draft)) { setProblem(badName(draft)); return }
    setProblem(null)
    onRename(draft)
  }
  return (
    <label style={labelStyle}>
      <span>Name</span>
      <input aria-label={`${name} name`} style={inputStyle} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      {problem && <span style={{ color: 'var(--danger)' }}>{problem}</span>}
    </label>
  )
}

export function EnvironmentForm({ value, onChange }) {
  const env = value || {}
  const repos = env.repositories && typeof env.repositories === 'object' ? env.repositories : {}
  const keys = Object.keys(repos)
  const set = (path, v) => onChange(setIn(env, path, v))
  const optional = (path, v) => set(path, v === '' ? undefined : v)
  const tick = (path, on) => set(path, on ? true : undefined)
  const [newName, setNewName] = React.useState('')
  const [newProblem, setNewProblem] = React.useState(null)
  const testKeys = keys.filter(k => repos[k]?.test && typeof repos[k].test === 'object')
  const defaults = Array.isArray(env.test?.defaultServices) ? env.test.defaultServices : []
  const wiring = Array.isArray(env.test?.wiring) ? env.test.wiring : []
  const showMobile = keys.some(k => repos[k]?.kind === 'mobile') || env.mobile !== undefined

  const add = () => {
    if (!REPOSITORY_KEY.test(newName) || keys.includes(newName)) { setNewProblem(badName(newName)); return }
    setNewProblem(null); setNewName('')
    onChange(addRepository(env, newName))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0 }}>
      <Section title="General">
        <div style={grid}><Field label="Name" aria="Name" value={env.name} onChange={v => optional(['name'], v)} /></div>
      </Section>

      <Section title="Repositories">
        {keys.map(k => {
          const r = repos[k] || {}
          const at = f => ['repositories', k, f]
          return (
            <div key={k} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={grid}>
                <RepositoryName name={k} taken={keys.filter(x => x !== k)} onRename={to => onChange(renameRepository(env, k, to))} />
                <Field label="Label" aria={`${k} label`} value={r.label} onChange={v => optional(at('label'), v)} />
                <label style={labelStyle}>
                  <span>Kind</span>
                  <select aria-label={`${k} kind`} style={inputStyle} value={r.kind ?? ''} onChange={e => set(at('kind'), e.target.value)}>
                    {!r.kind && <option value="">(choose)</option>}
                    <option value="api">api</option><option value="mobile">mobile</option><option value="web">web</option>
                  </select>
                </label>
                <Field label="Source (worktree, relative to devenv)" aria={`${k} source`} value={r.source} onChange={v => set(at('source'), v)} />
                <Field label="Ref" aria={`${k} ref`} value={r.ref} onChange={v => set(at('ref'), v)} />
                <Field label="Project (.csproj in the source)" aria={`${k} project`} value={r.project} onChange={v => set(at('project'), v)} />
                <Field label="Port" aria={`${k} port`} value={r.port === undefined ? '' : String(r.port)} onChange={v => set(at('port'), asPort(v))} />
                <Field label="DLL" aria={`${k} dll`} value={r.dll} onChange={v => optional(at('dll'), v)} />
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <Check label="Runs in Docker" aria={`${k} runs in Docker`} checked={r.docker} onChange={on => tick(at('docker'), on)} />
                <Check label="Built by devenv start" aria={`${k} built by devenv start`} checked={r.start} onChange={on => tick(at('start'), on)} />
                <Check label="Migration guard" aria={`${k} migration guard`} checked={r.migrationGuard} onChange={on => tick(at('migrationGuard'), on)} />
                <Check label="Runs in the test stack" aria={`${k} runs in the test stack`} checked={r.test !== undefined}
                  onChange={on => set(at('test'), on ? { db: '' } : undefined)} />
                <button className="btn sm ghost danger" style={{ marginLeft: 'auto' }} aria-label={`Remove ${k}`} onClick={() => onChange(removeRepository(env, k))}>Remove</button>
              </div>
              {r.test !== undefined && (
                <div style={grid}>
                  <Field label="Test port" aria={`${k} test port`} value={r.test?.port === undefined ? '' : String(r.test.port)} onChange={v => set(['repositories', k, 'test', 'port'], asPort(v))} />
                  <Field label="Test database" aria={`${k} test database`} value={r.test?.db} onChange={v => set(['repositories', k, 'test', 'db'], v)} />
                </div>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="New repository" aria="New repository name" value={newName} onChange={setNewName} />
          <button className="btn sm" onClick={add}>Add repository</button>
          {newProblem && <span style={{ color: 'var(--danger)' }}>{newProblem}</span>}
        </div>
      </Section>

      <Section title="Database">
        <div style={grid}>
          <Field label="Default database" aria="Database name" value={env.database?.name} onChange={v => optional(['database', 'name'], v)} />
          <DatabasesField databases={Array.isArray(env.database?.databases) ? env.database.databases : []} onCommit={v => set(['database', 'databases'], v)} />
          <Field label="Source container (for backups)" aria="Source container" value={env.database?.sourceContainer} onChange={v => optional(['database', 'sourceContainer'], v)} />
        </div>
      </Section>

      {showMobile && (
        <Section title="Mobile">
          <div style={grid}><Field label="Package id" aria="Mobile package id" value={env.mobile?.packageId} onChange={v => set(['mobile', 'packageId'], v)} /></div>
        </Section>
      )}

      <Section title="API test stack">
        <div style={grid}>
          <Field label="Collection folder" aria="Test collection" value={env.test?.collection} onChange={v => optional(['test', 'collection'], v)} />
          <Field label="Collection environment" aria="Collection environment" value={env.test?.collectionEnv} onChange={v => optional(['test', 'collectionEnv'], v)} />
        </div>
        {testKeys.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)' }}>Started by default:</span>
            {testKeys.map(k => (
              <Check key={k} label={k} aria={`${k} default test API`} checked={defaults.includes(k)}
                onChange={on => set(['test', 'defaultServices'], on ? [...defaults, k] : defaults.filter(x => x !== k))} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Wiring (which setting in one API points at another)</span>
          {wiring.map((w, i) => {
            const n = i + 1
            const at = f => ['test', 'wiring', i, f]
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select aria-label={`Wiring ${n} from`} style={inputStyle} value={w?.from ?? ''} onChange={e => set(at('from'), e.target.value)}>
                  <option value="">(from)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <select aria-label={`Wiring ${n} to`} style={inputStyle} value={w?.to ?? ''} onChange={e => set(at('to'), e.target.value)}>
                  <option value="">(to)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label={`Wiring ${n} setting`} placeholder="Setting" style={inputStyle} value={w?.key ?? ''} onChange={e => set(at('key'), e.target.value)} />
                <input aria-label={`Wiring ${n} local`} placeholder="Local value (optional)" style={inputStyle} value={w?.local ?? ''} onChange={e => set(at('local'), e.target.value === '' ? undefined : e.target.value)} />
                <Check label="Always" aria={`Wiring ${n} always`} checked={w?.always} onChange={on => set(at('always'), on ? true : undefined)} />
                <button className="btn sm ghost" aria-label={`Remove wiring ${n}`} onClick={() => set(['test', 'wiring'], wiring.filter((_, j) => j !== i))}>×</button>
              </div>
            )
          })}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set(['test', 'wiring'], [...wiring, { from: '', to: '', key: '' }])}>Add wiring</button>
        </div>
        <span style={{ color: 'var(--text-muted)' }}>extraDbConn and collectionPatterns are kept as they are - edit them in the Text view.</span>
      </Section>
    </div>
  )
}
