import React from 'react'
import { setIn, addRepository, renameRepository, removeRepository, REPOSITORY_KEY } from '@nexusmd/core'
import { Section, Field, Check } from './sections.jsx'

const asPort = v => (v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)
const badName = name => `"${name}" can't be used - lower-case letters, digits and -, not already taken.`

// Draft text so a trailing comma survives while typing; the array is committed on blur or Enter.
function DatabasesField({ databases, onCommit }) {
  const joined = databases.join(', ')
  const [draft, setDraft] = React.useState(joined)
  React.useEffect(() => { setDraft(joined) }, [joined])
  const commit = () => {
    const list = draft.trim() ? draft.split(',').map(s => s.trim()).filter(Boolean) : []
    if (list.length === databases.length && list.every((d, i) => d === databases[i])) return
    onCommit(list.length ? list : undefined)
  }
  return (
    <label className="nx-field">
      <span>Databases</span>
      <input className="nx-input" aria-label="Databases" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      <span className="nx-field-hint">Separate names with commas.</span>
    </label>
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
    <label className="nx-field">
      <span>Name</span>
      <input className="nx-input mono" aria-label={`${name} name`} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      {problem && <span className="nx-field-error">{problem}</span>}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <Section title="General">
        <div className="nx-fields"><Field label="Name" aria="Name" value={env.name} onChange={v => optional(['name'], v)} /></div>
      </Section>

      <Section title="Repositories" meta={`${keys.length} configured`}>
        {keys.map(k => {
          const r = repos[k] || {}
          const at = f => ['repositories', k, f]
          return (
            <div key={k} className="nx-repo">
              <div className="nx-repo-head">
                <span className="nx-strong nx-mono">{k}</span>
                {r.kind && <span className="nx-badge accent">{r.kind}</span>}
                {r.label && <span className="nx-muted nx-trunc" style={{ fontSize: 12.5 }}>{r.label}</span>}
                <button className="btn sm ghost danger" style={{ marginLeft: 'auto' }} aria-label={`Remove ${k}`} onClick={() => onChange(removeRepository(env, k))}>Remove</button>
              </div>
              <div className="nx-repo-body">
              <div className="nx-fields">
                <RepositoryName name={k} taken={keys.filter(x => x !== k)} onRename={to => onChange(renameRepository(env, k, to))} />
                <Field label="Label" aria={`${k} label`} value={r.label} onChange={v => optional(at('label'), v)} />
                <label className="nx-field">
                  <span>Kind</span>
                  <select className="nx-input" aria-label={`${k} kind`} value={r.kind ?? ''} onChange={e => set(at('kind'), e.target.value)}>
                    {!r.kind && <option value="">(choose)</option>}
                    <option value="api">api</option><option value="mobile">mobile</option><option value="web">web</option>
                  </select>
                </label>
                <Field label="Source" hint="Worktree, relative to devenv" mono aria={`${k} source`} value={r.source} onChange={v => set(at('source'), v)} />
                <Field label="Ref" mono aria={`${k} ref`} value={r.ref} onChange={v => set(at('ref'), v)} />
                <Field label="Project" hint=".csproj in the source" mono aria={`${k} project`} value={r.project} onChange={v => set(at('project'), v)} />
                <Field label="Port" mono inputMode="numeric" aria={`${k} port`} value={r.port === undefined ? '' : String(r.port)} onChange={v => set(at('port'), asPort(v))} />
                <Field label="DLL" mono aria={`${k} dll`} value={r.dll} onChange={v => optional(at('dll'), v)} />
              </div>
              <div className="nx-checks">
                <Check label="Runs in Docker" aria={`${k} runs in Docker`} checked={r.docker} onChange={on => tick(at('docker'), on)} />
                <Check label="Built by devenv start" aria={`${k} built by devenv start`} checked={r.start} onChange={on => tick(at('start'), on)} />
                <Check label="Migration guard" aria={`${k} migration guard`} checked={r.migrationGuard} onChange={on => tick(at('migrationGuard'), on)} />
                <Check label="Runs in the test stack" aria={`${k} runs in the test stack`} checked={r.test !== undefined}
                  onChange={on => set(at('test'), on ? { db: '' } : undefined)} />
              </div>
              {r.test !== undefined && (
                <div className="nx-fields">
                  <Field label="Test port" aria={`${k} test port`} value={r.test?.port === undefined ? '' : String(r.test.port)} onChange={v => set(['repositories', k, 'test', 'port'], asPort(v))} />
                  <Field label="Test database" aria={`${k} test database`} value={r.test?.db} onChange={v => set(['repositories', k, 'test', 'db'], v)} />
                </div>
              )}
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="New repository" mono placeholder="lower-case-name" aria="New repository name" value={newName} onChange={setNewName} />
          <button className="btn sm" onClick={add}>Add repository</button>
          {newProblem && <span className="nx-field-error" style={{ alignSelf: 'center' }}>{newProblem}</span>}
        </div>
      </Section>

      <Section title="Database">
        <div className="nx-fields">
          <Field label="Default database" aria="Database name" value={env.database?.name} onChange={v => optional(['database', 'name'], v)} />
          <DatabasesField databases={Array.isArray(env.database?.databases) ? env.database.databases : []} onCommit={v => set(['database', 'databases'], v)} />
          <Field label="Source container" hint="Backups are taken from it" mono aria="Source container" value={env.database?.sourceContainer} onChange={v => optional(['database', 'sourceContainer'], v)} />
        </div>
      </Section>

      {showMobile && (
        <Section title="Mobile">
          <div className="nx-fields"><Field label="Package id" mono aria="Mobile package id" value={env.mobile?.packageId} onChange={v => set(['mobile', 'packageId'], v)} /></div>
        </Section>
      )}

      <Section title="API test stack">
        <div className="nx-fields">
          <Field label="Collection folder" aria="Test collection" value={env.test?.collection} onChange={v => optional(['test', 'collection'], v)} />
          <Field label="Collection environment" aria="Collection environment" value={env.test?.collectionEnv} onChange={v => optional(['test', 'collectionEnv'], v)} />
        </div>
        {testKeys.length > 0 && (
          <div className="nx-checks">
            <span className="nx-muted" style={{ fontSize: 12 }}>Started by default</span>
            {testKeys.map(k => (
              <Check key={k} label={k} aria={`${k} default test API`} checked={defaults.includes(k)}
                onChange={on => set(['test', 'defaultServices'], on ? [...defaults, k] : defaults.filter(x => x !== k))} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div className="nx-strong">Wiring</div>
            <div className="nx-section-note">Which setting in one API points at another.</div>
          </div>
          {wiring.map((w, i) => {
            const n = i + 1
            const at = f => ['test', 'wiring', i, f]
            return (
              <div key={i} className="nx-wire">
                <select aria-label={`Wiring ${n} from`} className="nx-input" value={w?.from ?? ''} onChange={e => set(at('from'), e.target.value)}>
                  <option value="">(from)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <select aria-label={`Wiring ${n} to`} className="nx-input" value={w?.to ?? ''} onChange={e => set(at('to'), e.target.value)}>
                  <option value="">(to)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label={`Wiring ${n} setting`} placeholder="Setting" className="nx-input mono" value={w?.key ?? ''} onChange={e => set(at('key'), e.target.value)} />
                <input aria-label={`Wiring ${n} local`} placeholder="Local value (optional)" className="nx-input" value={w?.local ?? ''} onChange={e => set(at('local'), e.target.value === '' ? undefined : e.target.value)} />
                <span className="nx-checks"><Check label="Always" aria={`Wiring ${n} always`} checked={w?.always} onChange={on => set(at('always'), on ? true : undefined)} /></span>
                <button className="nx-icon-btn" aria-label={`Remove wiring ${n}`} onClick={() => set(['test', 'wiring'], wiring.filter((_, j) => j !== i))}>×</button>
              </div>
            )
          })}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set(['test', 'wiring'], [...wiring, { from: '', to: '', key: '' }])}>Add wiring</button>
        </div>
        <span className="nx-field-hint">extraDbConn and collectionPatterns are kept as they are. Edit them in the Text view.</span>
      </Section>
    </div>
  )
}
