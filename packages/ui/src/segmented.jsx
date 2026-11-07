import React from 'react'

/**
 * A segmented control: a track with one tab per option, the selected one raised. `size="sm"` is the compact form.
 * options: [{ id, label }]. onChange(id) is called when another tab is clicked.
 */
export function Segmented({ options, value, onChange, ariaLabel, size = 'md' }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={`nx-seg${size === 'sm' ? ' sm' : ''}`}>
      {options.map(o => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}
