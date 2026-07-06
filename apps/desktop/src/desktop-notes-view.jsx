import React from 'react'
import { GlobalNotesView, loadGlobalNotes, saveGlobalNotes } from '@nexusmd/ui'
import { getIsoWeek } from '@nexusmd/core'

// Standalone top-level "Notes" view: the week-agnostic notes library, lifted out
// of the Planner into its own sidebar tab. There is no "current week" here, so we
// compute this week's short label for the note "Complete in <week>" action.
function thisWeekShortLabel() {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1)
  return `W${getIsoWeek(monday)}`
}

export default function DesktopNotesView() {
  const [notes, setNotesRaw] = React.useState(() => loadGlobalNotes())
  const setNotes = React.useCallback((fn) => setNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn
    saveGlobalNotes(next)
    return next
  }), [])
  const weekLabel = React.useMemo(thisWeekShortLabel, [])

  return (
    <div style={{ padding: 4 }}>
      <GlobalNotesView notes={notes} setNotes={setNotes} weekLabel={weekLabel} />
    </div>
  )
}
