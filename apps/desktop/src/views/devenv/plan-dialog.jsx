import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { createPlanForm, validatePlanForm, buildPlanAnswer } from '@nexusmd/core'

const field = { padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const section = { display: 'flex', flexDirection: 'column', gap: 6 }
const heading = { fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 6 }
const mb = n => `${Math.max(1, Math.round((n || 0) / 1048576))} MB`

function Radio({ name, value, current, label, disabled, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 8, opacity: disabled ? 0.6 : 1 }}>
      <input type="radio" name={name} checked={current === value} disabled={disabled} aria-label={label} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  )
}

// The devenv start plan as a form. Every way out answers with devplan's result format, so
// devenv's own start loop decides what happens next (start, re-plan after a branch change,
// or "Cancelled - nothing was started").
export function PlanDialog({ prompt, onAnswer }) {
  const plan = prompt.plan || {}
  const [form, setForm] = React.useState(() => createPlanForm(plan))
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const blocked = validatePlanForm(plan, form)
  const answer = action => onAnswer(buildPlanAnswer(form, action))
  const restoring = form.database === 'restore' || form.database === 'wipe'

  const footer = (
    <>
      {blocked && <span style={{ color: 'var(--danger)', marginRight: 'auto' }}>{blocked}</span>}
      <button className="btn ghost" onClick={() => answer('cancel')}>Cancel</button>
      <button className="btn primary" disabled={!!blocked} onClick={() => answer('start')}>Start</button>
    </>
  )

  return (
    <PlModal open wide closeOnBackdrop={false} onClose={() => answer('cancel')} icon="build" title={prompt.title || 'Start'} sub={plan.dockerApis ? `Always: local SQL, cloud emulators and ${plan.dockerApis}` : undefined} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!plan.locked && <div role="alert" style={{ color: 'var(--danger)' }}>{plan.lockError || 'A ref did not resolve.'}</div>}

        <div style={section}>
          <div style={heading}>Sources</div>
          {(plan.services || []).map(s => (
            <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px 170px auto', gap: 8, alignItems: 'center' }}>
              <strong>{s.label}</strong>
              <span>{`${s.branch && s.branch !== 'unknown' ? s.branch : s.ref}${s.dirty ? '*' : ''}`}</span>
              <code>{(s.sha || '????????').slice(0, 8)}</code>
              <select aria-label={`Build ${s.label}`} style={field} value={form.services[s.key]} onChange={e => set({ services: { ...form.services, [s.key]: e.target.value } })}>
                <option value="skip">{s.built ? 'Skip (already built)' : 'Skip'}</option>
                <option value="build">Build</option>
                <option value="clean">Clean rebuild</option>
              </select>
              <button className="btn sm ghost" onClick={() => answer(`change-ref:${s.key}`)}>Change branch…</button>
            </div>
          ))}
        </div>

        <div style={section} role="radiogroup" aria-label="Database">
          <div style={heading}>Database</div>
          <Radio name="db" value="asis" current={form.database} label="Leave the data as it is" onChange={v => set({ database: v })} />
          <Radio name="db" value="restore" current={form.database} label="Restore a saved baseline" onChange={v => set({ database: v })} />
          <Radio name="db" value="wipe" current={form.database} label="Wipe the SQL volume, then restore a baseline" onChange={v => set({ database: v })} />
          <Radio name="db" value="remote" current={form.database} label="Use the remote DEV database (shared — changes are real)" onChange={v => set({ database: v })} />
          {restoring && (
            <select aria-label="Baseline" style={field} value={form.baseline || ''} onChange={e => set({ baseline: e.target.value })}>
              {(plan.backups || []).map(b => <option key={b.id} value={b.id}>{`${b.id} (${mb(b.size)})${b.isLatest ? ' — latest' : ''}`}</option>)}
            </select>
          )}
          {form.database === 'wipe' && (
            <input aria-label="Type YES to wipe" placeholder="YES" style={field} value={form.wipeConfirm} onChange={e => set({ wipeConfirm: e.target.value })} />
          )}
        </div>

        <div style={section} role="radiogroup" aria-label="Test stack">
          <div style={heading}>Test stack</div>
          {plan.testError && <div style={{ color: 'var(--text-muted)' }}>{plan.testError}</div>}
          <Radio name="test" value="off" current={form.test} label="Leave it alone" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          <Radio name="test" value="up" current={form.test} label="Start APIs behind the tracer" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          <Radio name="test" value="run" current={form.test} label="Start them, then run the Bruno collection" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          {!plan.testError && (plan.testApis || []).map(t => (
            <label key={t.key} style={{ display: 'flex', gap: 8, marginLeft: 22 }}>
              <input type="checkbox" checked={form.testServices.includes(t.key)}
                onChange={e => set({ testServices: e.target.checked ? [...form.testServices, t.key] : form.testServices.filter(k => k !== t.key) })} />
              <span>{`${t.label} :${t.port}`}</span>
            </label>
          ))}
        </div>

        <div style={section}>
          <div style={heading}>Android</div>
          <label style={{ display: 'flex', gap: 8 }}>
            <input type="checkbox" aria-label="Start the Android emulator" checked={form.emulator} onChange={e => set({ emulator: e.target.checked })} />
            <span>Start the Android emulator (through mitmproxy)</span>
          </label>
        </div>

        <div style={section} role="radiogroup" aria-label="iOS">
          <div style={heading}>iOS</div>
          {plan.macError && <div style={{ color: 'var(--text-muted)' }}>{plan.macError}</div>}
          <Radio name="ios" value="off" current={form.ios} label="Leave it alone" onChange={v => set({ ios: v })} />
          <Radio name="ios" value="run" current={form.ios} label="Build, then run on the simulator" disabled={!!plan.macError} onChange={v => set({ ios: v })} />
          <Radio name="ios" value="build" current={form.ios} label="Build only" disabled={!!plan.macError} onChange={v => set({ ios: v })} />
        </div>
      </div>
    </PlModal>
  )
}
