import React from 'react'
import { Icon } from '@nexusmd/ui'
import { PopoverMenu } from './popover-menu.jsx'

const repos = n => `${n} ${n === 1 ? 'repo' : 'repos'}`

/**
 * The project group, chosen from a menu: a button showing the active group and its repository count, and
 * a + button for a new group. `busy` (a reason string) disables + until there is something to pick from.
 */
export function GroupPicker({ tabs, active, onSelect, onNew, busy = null }) {
  const current = tabs.find(t => (t.id ?? t.name) === active) ?? tabs[0]
  const label = (
    <>
      <span className="nx-gw-picker-name">{current?.name}</span>
      {current && <span className="n">{repos(current.repos)}</span>}
      <Icon name="chevron-down" size={11} />
    </>
  )
  return (
    <div className="nx-gw-picker">
      <PopoverMenu label={label} align="left" buttonClassName="nx-gw-picker-btn" menuLabel="Project groups"
        buttonProps={{ title: 'Switch project group' }}
        items={tabs.map(t => ({
          label: t.name, checked: (t.id ?? t.name) === active, onSelect: () => onSelect(t.id ?? t.name),
          content: <>{t.name}<span className="n">{repos(t.repos)}</span></>,
        }))} />
      <button type="button" className="nx-gw-icon-btn nx-gw-plus-btn" aria-label="New group" title={busy ?? 'New group'} disabled={!!busy} onClick={onNew}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  )
}
