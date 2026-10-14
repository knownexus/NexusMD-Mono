// Small field controls shared by the environment.json and mac.json forms. Each shows the
// validation messages whose `at` is exactly its own path, right under it.
import React from 'react'

export const inputStyle = {
  width: '100%', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, boxSizing: 'border-box',
}

export function issuesAt(issues, at) {
  return (issues || []).filter(i => i.at === at)
}

export function FieldIssues({ issues, at }) {
  const list = issuesAt(issues, at)
  if (!list.length) return null
  return list.map((i, n) => (
    <div key={n} role="note" style={{ fontSize: 12, color: i.warning ? 'var(--warning, #b8860b)' : 'var(--danger)' }}>{i.message}</div>
  ))
}

export function Field({ label, at, issues, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}{hint ? ` - ${hint}` : ''}</span>
      {children}
      <FieldIssues issues={issues} at={at} />
    </label>
  )
}

// Optional text: emptying the box removes the key rather than writing "".
export function TextField({ label, at, issues, value, onChange, required = false, hint, placeholder }) {
  return (
    <Field label={label} at={at} issues={issues} hint={hint}>
      <input aria-label={label} style={inputStyle} value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' && !required ? undefined : e.target.value)} />
    </Field>
  )
}

// Whole numbers are written as numbers; anything else stays text so validation can say why.
export function NumberField({ label, at, issues, value, onChange, hint }) {
  return (
    <Field label={label} at={at} issues={issues} hint={hint}>
      <input aria-label={label} style={inputStyle} inputMode="numeric" value={value == null ? '' : String(value)}
        onChange={e => {
          const v = e.target.value.trim()
          onChange(v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)
        }} />
    </Field>
  )
}

// Unticking removes the key: devenv reads a missing switch as false.
export function CheckField({ label, at, issues, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" aria-label={label} checked={value === true} onChange={e => onChange(e.target.checked ? true : undefined)} />
        <span>{label}</span>
      </label>
      <FieldIssues issues={issues} at={at} />
    </div>
  )
}

export function OtherFields({ fields }) {
  if (!fields.length) return null
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      {'Other settings (kept as they are; edit in Text): '}
      {fields.map((f, i) => <code key={f}>{i ? ', ' : ''}{f}</code>)}
    </div>
  )
}

export function Section({ title, children }) {
  return (
    <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <legend style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 4px' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

export const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }
