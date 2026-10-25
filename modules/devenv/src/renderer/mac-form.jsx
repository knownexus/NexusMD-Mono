import React from 'react'
import { setIn } from '@nexusmd/core'
import { Section, Field } from './sections.jsx'

export function MacForm({ value: given, onChange }) {
  const value = given || {}
  const set = (k, v, optional) => onChange(setIn(value, [k], optional && v === '' ? undefined : v))
  return (
    <Section title="Mac for iOS builds">
      <div className="nx-fields">
        <Field label="Host" aria="Mac host" mono value={value.host} onChange={v => set('host', v)} hint="The Mac's IP address or host name." />
        <Field label="User" aria="Mac user" mono value={value.user} onChange={v => set('user', v)} hint="Your login name on the Mac." />
        <Field label="SSH key" aria="SSH key file" mono value={value.sshKey} onChange={v => set('sshKey', v, true)} hint="Set by Set up SSH key in the Mac tab." />
      </div>
    </Section>
  )
}
