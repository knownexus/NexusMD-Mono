import React from 'react'
import { usePersistedState } from '@nexusmd/shell-sdk'
import { CalendarView } from './view-calendar.jsx'

// The Calendar screen: CalendarView with its local events kept per profile and the shell's
// Microsoft sign-in. "Open in Planner" only exists when the Planner app is installed.
export function CalendarApp({ host }) {
  const [events, setEvents] = usePersistedState('nexusmd.calendar.events', [])
  const msAuth = React.useMemo(() => host.cloud.makeOAuthService('microsoft'), [host])
  return (
    <CalendarView
      calendarEvents={events}
      setCalendarEvents={setEvents}
      msAuth={msAuth}
      onNavigatePlanner={host.isInstalled('planner') ? () => host.navigate('planner') : undefined}
    />
  )
}
