import React from 'react'
import {
  setProfileValue, addProfileRepository, removeProfileRepository, moveProfileRepository, renameProfileRepository,
  unknownEnvironmentFields,
} from '@nexusmd/core'
import { TextField, NumberField, CheckField, FieldIssues, OtherFields, Section, Field, inputStyle, grid } from './profile-fields.jsx'

const KINDS = ['api', 'mobile', 'web']
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

function KeyInput({ repoKey, onRename }) {
  const [text, setText] = React.useState(repoKey)
  const [error, setError] = React.useState(null)
  React.useEffect(() => { setText(repoKey); setError(null) }, [repoKey])
  // Committed on blur / Enter, not per keystroke: each rename rewrites the test references.
  const commit = () => {
    const next = text.trim()
    if (!next || next === repoKey) { setText(repoKey); return }
    try { onRename(next); setError(null) } catch (e) { setError(e.message) }
  }
  return (
    <Field label="Key" at="__key" issues={[]} hint="used in devenv commands and folder names">
      <input aria-label={`Key of ${repoKey}`} style={inputStyle} value={text}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
      {error && <div role="note" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
    </Field>
  )
}

function Repository({ repoKey, repo, index, count, issues, env, onChange }) {
  const at = `repositories.${repoKey}`
  const r = isObject(repo) ? repo : {}
  const set = (field, v) => onChange(setProfileValue(env, ['repositories', repoKey, field], v))
  const setTest = (field, v) => onChange(setProfileValue(env, ['repositories', repoKey, 'test', field], v))
  const hasTest = r.test !== undefined
  return (
    <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }} aria-label={`Repository ${repoKey}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong style={{ flex: 1 }}>{typeof r.label === 'string' && r.label ? `${r.label} (${repoKey})` : repoKey}</strong>
        <button type="button" className="btn sm ghost" aria-label={`Move ${repoKey} up`} disabled={index === 0} onClick={() => onChange(moveProfileRepository(env, repoKey, -1))}>↑</button>
        <button type="button" className="btn sm ghost" aria-label={`Move ${repoKey} down`} disabled={index === count - 1} onClick={() => onChange(moveProfileRepository(env, repoKey, 1))}>↓</button>
        <button type="button" className="btn sm ghost danger" onClick={() => onChange(removeProfileRepository(env, repoKey))}>{`Remove ${repoKey}`}</button>
      </div>
      <FieldIssues issues={issues} at={at} />
      <div style={grid}>
        <KeyInput repoKey={repoKey} onRename={to => onChange(renameProfileRepository(env, repoKey, to))} />
        <TextField label="Label" at={`${at}.label`} issues={issues} value={r.label} onChange={v => set('label', v)} />
        <Field label="Kind" at={`${at}.kind`} issues={issues}>
          <select aria-label="Kind" style={inputStyle} value={KINDS.includes(r.kind) ? r.kind : ''} onChange={e => set('kind', e.target.value || undefined)}>
            {!KINDS.includes(r.kind) && <option value="">(choose)</option>}
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <TextField label="Source" at={`${at}.source`} issues={issues} value={r.source} required hint="worktree, relative to devenv" onChange={v => set('source', v)} />
        <TextField label="Ref" at={`${at}.ref`} issues={issues} value={r.ref} required onChange={v => set('ref', v)} />
        <TextField label="Project" at={`${at}.project`} issues={issues} value={r.project} required hint=".csproj in the repository" onChange={v => set('project', v)} />
        <NumberField label="Port" at={`${at}.port`} issues={issues} value={r.port} onChange={v => set('port', v)} />
        <TextField label="DLL" at={`${at}.dll`} issues={issues} value={r.dll} placeholder="API.dll" onChange={v => set('dll', v)} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <CheckField label="Docker" at={`${at}.docker`} issues={issues} value={r.docker} onChange={v => set('docker', v)} />
        <CheckField label="Built by start" at={`${at}.start`} issues={issues} value={r.start} onChange={v => set('start', v)} />
        <CheckField label="Migration guard" at={`${at}.migrationGuard`} issues={issues} value={r.migrationGuard} onChange={v => set('migrationGuard', v)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" aria-label="API test stack" checked={hasTest} onChange={e => set('test', e.target.checked ? {} : undefined)} />
          <span>API test stack</span>
        </label>
      </div>
      {hasTest && (
        <div style={grid}>
          <FieldIssues issues={issues} at={`${at}.test`} />
          <NumberField label="Test port" at={`${at}.test.port`} issues={issues} value={r.test?.port} onChange={v => setTest('port', v)} />
          <TextField label="Test database" at={`${at}.test.db`} issues={issues} value={r.test?.db} onChange={v => setTest('db', v)} />
        </div>
      )}
    </div>
  )
}

function AddRepository({ env, onChange }) {
  const [kind, setKind] = React.useState('api')
  const [key, setKey] = React.useState('')
  const [error, setError] = React.useState(null)
  const add = () => {
    const k = key.trim() || (kind === 'mobile' ? 'mobile' : '')
    if (!k) { setError('Give the repository a key.'); return }
    try { onChange(addProfileRepository(env, k, kind)); setKey(''); setError(null) } catch (e) { setError(e.message) }
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select aria-label="New repository kind" style={{ ...inputStyle, width: 'auto' }} value={kind}
        onChange={e => { setKind(e.target.value); if (e.target.value === 'mobile' && !key) setKey('mobile') }}>
        {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <input aria-label="New repository key" style={{ ...inputStyle, width: 180 }} placeholder="key" value={key} onChange={e => setKey(e.target.value)} />
      <button type="button" className="btn sm" onClick={add}>Add repository</button>
      {error && <span role="note" style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
    </div>
  )
}

// An object of text values (test.extraDbConn, test.collectionPatterns) as rows, keeping order.
function KeyValueTable({ label, at, issues, value, onChange, keyLabel, valueLabel }) {
  const obj = isObject(value) ? value : {}
  const entries = Object.entries(obj)
  const write = next => onChange(next.length ? Object.fromEntries(next) : undefined)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input aria-label={`${label} ${keyLabel} ${i + 1}`} style={inputStyle} value={k}
            onChange={e => write(entries.map((en, j) => (j === i ? [e.target.value, en[1]] : en)))} />
          <input aria-label={`${label} ${valueLabel} ${i + 1}`} style={inputStyle} value={typeof v === 'string' ? v : JSON.stringify(v)}
            onChange={e => write(entries.map((en, j) => (j === i ? [en[0], e.target.value] : en)))} />
          <button type="button" className="btn sm ghost" aria-label={`Remove ${label} ${i + 1}`} onClick={() => write(entries.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }}
        disabled={Object.hasOwn(obj, '')} onClick={() => write([...entries, ['', '']])}>{`Add ${label}`}</button>
      <FieldIssues issues={issues} at={at} />
    </div>
  )
}

function Wiring({ env, keys, issues, onChange }) {
  const list = Array.isArray(env.test?.wiring) ? env.test.wiring : []
  const set = (i, field, v) => onChange(setProfileValue(env, ['test', 'wiring', i, field], v))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Wiring - which setting in which API points at which other API</span>
      {list.map((w, i) => {
        const at = `test.wiring.${i}`
        const row = isObject(w) ? w : {}
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {['from', 'to'].map(f => (
                <select key={f} aria-label={`Wiring ${i + 1} ${f}`} style={{ ...inputStyle, width: 'auto' }} value={keys.includes(row[f]) ? row[f] : ''}
                  onChange={e => set(i, f, e.target.value || undefined)}>
                  <option value="">({f})</option>
                  {keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              ))}
              <input aria-label={`Wiring ${i + 1} key`} style={{ ...inputStyle, width: 200 }} placeholder="setting" value={typeof row.key === 'string' ? row.key : ''}
                onChange={e => set(i, 'key', e.target.value)} />
              <input aria-label={`Wiring ${i + 1} local`} style={{ ...inputStyle, width: 160 }} placeholder="local (optional)" value={typeof row.local === 'string' ? row.local : ''}
                onChange={e => set(i, 'local', e.target.value || undefined)} />
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" aria-label={`Wiring ${i + 1} always`} checked={row.always === true} onChange={e => set(i, 'always', e.target.checked ? true : undefined)} />always
              </label>
              <button type="button" className="btn sm ghost" aria-label={`Remove wiring ${i + 1}`} onClick={() => onChange(setProfileValue(env, ['test', 'wiring', i], undefined))}>×</button>
            </div>
            {['', '.from', '.to', '.key', '.local', '.always'].map(s => <FieldIssues key={s} issues={issues} at={at + s} />)}
          </div>
        )
      })}
      <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange(setProfileValue(env, ['test', 'wiring'], [...list, { from: '', to: '', key: '' }]))}>Add wiring</button>
      <FieldIssues issues={issues} at="test.wiring" />
    </div>
  )
}

export function EnvironmentForm({ value, issues, onChange }) {
  const env = isObject(value) ? value : {}
  const repos = isObject(env.repositories) ? env.repositories : {}
  const keys = Object.keys(repos)
  const testKeys = keys.filter(k => isObject(repos[k]) && repos[k].test !== undefined)
  const hasMobile = keys.some(k => repos[k]?.kind === 'mobile')
  const set = (path, v) => onChange(setProfileValue(env, path, v))
  const defaults = Array.isArray(env.test?.defaultServices) ? env.test.defaultServices : []
  const toggleDefault = (k, on) => {
    const next = on ? [...defaults.filter(d => d !== k), k] : defaults.filter(d => d !== k)
    set(['test', 'defaultServices'], next.length ? next : undefined)
  }
  const databases = Array.isArray(env.database?.databases) ? env.database.databases.join(', ') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <FieldIssues issues={issues} at="" />
      <div style={grid}>
        <TextField label="Name" at="name" issues={issues} value={env.name} onChange={v => set(['name'], v)} />
      </div>

      <Section title="Repositories">
        <FieldIssues issues={issues} at="repositories" />
        {keys.map((k, i) => (
          <Repository key={k} repoKey={k} repo={repos[k]} index={i} count={keys.length} issues={issues} env={env} onChange={onChange} />
        ))}
        <AddRepository env={env} onChange={onChange} />
      </Section>

      <Section title="Database">
        <FieldIssues issues={issues} at="database" />
        <div style={grid}>
          <TextField label="Local database" at="database.name" issues={issues} value={env.database?.name} onChange={v => set(['database', 'name'], v)} />
          <Field label="Databases in a baseline" at="database.databases" issues={issues} hint="comma-separated">
            <input aria-label="Databases in a baseline" style={inputStyle} defaultValue={databases} key={databases}
              onBlur={e => {
                const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                set(['database', 'databases'], list.length ? list : undefined)
              }} />
          </Field>
          <TextField label="Back up from container" at="database.sourceContainer" issues={issues} value={env.database?.sourceContainer} onChange={v => set(['database', 'sourceContainer'], v)} />
        </div>
      </Section>

      {(hasMobile || env.mobile !== undefined) && (
        <Section title="Mobile">
          <FieldIssues issues={issues} at="mobile" />
          <div style={grid}>
            <TextField label="Package id" at="mobile.packageId" issues={issues} value={env.mobile?.packageId} onChange={v => set(['mobile', 'packageId'], v)} />
          </div>
        </Section>
      )}

      <Section title="API test stack">
        <FieldIssues issues={issues} at="test" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Started by default</span>
          {testKeys.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No repository runs in the test stack yet.</span>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {testKeys.map(k => (
              <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" aria-label={`Default service ${k}`} checked={defaults.includes(k)} onChange={e => toggleDefault(k, e.target.checked)} />{k}
              </label>
            ))}
          </div>
          {defaults.map((_, i) => <FieldIssues key={i} issues={issues} at={`test.defaultServices.${i}`} />)}
          <FieldIssues issues={issues} at="test.defaultServices" />
        </div>
        <div style={grid}>
          <TextField label="Collection" at="test.collection" issues={issues} value={env.test?.collection} placeholder="api-tests" onChange={v => set(['test', 'collection'], v)} />
          <TextField label="Collection environment" at="test.collectionEnv" issues={issues} value={env.test?.collectionEnv} placeholder="docker" onChange={v => set(['test', 'collectionEnv'], v)} />
        </div>
        <Wiring env={env} keys={keys} issues={issues} onChange={onChange} />
        <KeyValueTable label="Extra database connection" at="test.extraDbConn" issues={issues} value={env.test?.extraDbConn}
          keyLabel="setting" valueLabel="database" onChange={v => set(['test', 'extraDbConn'], v)} />
        <KeyValueTable label="Collection pattern" at="test.collectionPatterns" issues={issues} value={env.test?.collectionPatterns}
          keyLabel="pattern" valueLabel="API" onChange={v => set(['test', 'collectionPatterns'], v)} />
      </Section>

      <OtherFields fields={unknownEnvironmentFields(env)} />
    </div>
  )
}
