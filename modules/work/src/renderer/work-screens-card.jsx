import React from 'react'
import { VsCard, VsRow, PlToggle, toast } from '@nexusmd/ui'
import { WORK_SCREENS, FETCHED_BY, useOffScreens, setOffScreens } from './work-screens.js'

// Switch Work's screens on and off (see work-screens.js for what that does to each). Applies at once.
export function WorkScreensCard() {
  const off = useOffScreens()

  const toggle = (id, on) => {
    const next = on ? off.filter(x => x !== id) : [...off, id]
    if (!setOffScreens(next)) toast?.('At least one Work screen has to stay on.', 'error')
  }

  const describe = (id, isOn) => {
    if (isOn) return 'On'
    return FETCHED_BY[id] ? 'Off — not shown or fetched' : 'Off — hidden'
  }

  return (
    <VsCard title="Work screens" icon="work">
      {WORK_SCREENS.map(({ id, label }) => {
        const isOn = !off.includes(id)
        return (
          <VsRow key={id} title={label} desc={describe(id, isOn)}>
            <PlToggle checked={isOn} onChange={v => toggle(id, v)} />
          </VsRow>
        )
      })}
    </VsCard>
  )
}
