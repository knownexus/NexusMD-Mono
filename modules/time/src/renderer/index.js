import { TimeApp } from './time-app.jsx'

// What the shell gets from the Time app (see apps/desktop/src/shell/modules.js).
// Tickets to track against come from the Work app through the `work.items` capability, when installed.
export default {
  id: 'time',
  views: { time: TimeApp },
}
