import React from 'react'
import { setIn } from '@nexusmd/core'

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

function Field({ label, aria, value, onChange, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <input aria-label={aria} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)} />
      {hint && <span>{hint}</span>}
    </label>
  )
}

export function MacForm({ value: given, onChange }) {
  const value = given || {}
  const set = (k, v, optional) => onChange(setIn(value, [k], optional && v === '' ? undefined : v))
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
      <Field label="Host" aria="Mac host" value={value.host} onChange={v => set('host', v)} hint="The Mac's IP address or host name." />
      <Field label="User" aria="Mac user" value={value.user} onChange={v => set('user', v)} hint="Your login name on the Mac." />
      <Field label="SSH key" aria="SSH key file" value={value.sshKey} onChange={v => set('sshKey', v, true)} hint="Set by Set up SSH key in the Mac tab." />
    </div>
  )
}
