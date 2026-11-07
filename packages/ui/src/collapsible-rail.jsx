import React from 'react'
import { Icon } from './icons.jsx'

const COLLAPSED = 40

/** The grid column a rail takes: its width open, a 40px strip closed. Parents animate grid-template-columns. */
export const railColumns = (open, width) => `${open ? width : COLLAPSED}px`

/** The button that hides an open rail; the rail's content puts it where it wants (top right by default). */
export function RailHideButton({ onToggle }) {
  return (
    <button type="button" className="nx-rail-hide" aria-label="Hide panel" title="Hide panel (Ctrl+])" onClick={onToggle}>
      <Icon name="panel-right-close" size={14} />
    </button>
  )
}

/**
 * A collapsible right-hand panel. Open, it shows its children with a hide button top right; closed, it is a
 * 40px strip (the whole strip a button) with the label written vertically. The parent sizes the column.
 */
export function CollapsibleRail({ open, onToggle, label, children }) {
  if (!open) {
    return (
      <button type="button" className="nx-rail-strip" aria-expanded="false" aria-label={`Show ${label}`} title={`Show ${label} (Ctrl+])`} onClick={onToggle}>
        <Icon name="panel-right-open" size={14} />
        <span className="nx-rail-strip-label">{label}</span>
      </button>
    )
  }
  return (
    <aside className="nx-rail" aria-label={label}>
      <RailHideButton onToggle={onToggle} />
      {children}
    </aside>
  )
}
