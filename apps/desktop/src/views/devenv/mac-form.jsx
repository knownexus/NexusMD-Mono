import React from 'react'
import { setProfileValue, unknownMacFields } from '@nexusmd/core'
import { TextField, FieldIssues, OtherFields, Field, inputStyle, grid } from './profile-fields.jsx'

// mac.json: the Mac build host for iOS. The key itself is made on the Mac tab.
export function MacForm({ value, issues, onChange, picker }) {
  const mac = value && typeof value === 'object' ? value : {}
  const set = (field, v) => onChange(setProfileValue(mac, [field], v))
  const browse = async () => {
    const p = await picker?.pickFile?.()
    if (p) set('sshKey', p)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FieldIssues issues={issues} at="" />
      <div style={grid}>
        <TextField label="Host" at="host" issues={issues} value={mac.host} required hint="the Mac's IP address or name" onChange={v => set('host', v)} />
        <TextField label="User" at="user" issues={issues} value={mac.user} required hint="your Mac login" onChange={v => set('user', v)} />
      </div>
      <Field label="SSH key" at="sshKey" issues={issues} hint="optional; the Mac tab sets this up">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="SSH key" style={inputStyle} value={typeof mac.sshKey === 'string' ? mac.sshKey : ''}
            onChange={e => set('sshKey', e.target.value === '' ? undefined : e.target.value)} />
          <button type="button" className="btn sm ghost" onClick={browse}>Browse…</button>
        </div>
      </Field>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Set up or replace the key from the Mac tab.</span>
      <OtherFields fields={unknownMacFields(mac)} />
    </div>
  )
}
