import { CalendarApp } from './calendar-app.jsx'
import { configureGoogleCalendar } from './google-calendar.js'
import { createCalendarEvent, toLocalDateTimeString } from './ms-graph-calendar.js'

// Puts a meeting on the user's Outlook calendar if they have signed in to Microsoft; resolves
// true when it did, false when there was no sign-in to use.
export async function scheduleMeeting(host, { title, start, end }) {
  const ms = host.cloud.makeOAuthService('microsoft')
  if (!ms.isConnected()) return false
  await createCalendarEvent(ms.getToken, {
    title,
    start: toLocalDateTimeString(start),
    end: toLocalDateTimeString(end),
  })
  return true
}

// What the shell gets from the Calendar app (see apps/desktop/src/shell/modules.js).
//   views     view id -> component, rendered as <View adapters={...} host={...} />
//   activate  registers what this app offers other apps:
//               calendar.scheduleMeeting({ title, start: Date, end: Date })
export default {
  id: 'calendar',
  views: { calendar: CalendarApp },
  activate(host) {
    configureGoogleCalendar(() => host.cloud.makeNativeGoogleBinding())
    host.capabilities.provide('calendar.scheduleMeeting', meeting => scheduleMeeting(host, meeting))
  },
}
