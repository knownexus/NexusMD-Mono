// calendar-alerts.js — browser notification alerts for Google Calendar events
// Fires two alerts per event: one N minutes before (configurable), one at start.
// Tracks fired alerts in a session Set so they never repeat in the same tab.

import { GoogleAuth } from './google-auth.js';

'use strict';

const CHECK_MS     = 60_000; // poll every minute
const WINDOW_MS    = 90_000; // fire alert if within this window of target time
const notified     = new Set();

// ── Helpers ───────────────────────────────────────────────────────

function reminderMins() {
  return Math.max(1, parseInt(localStorage.getItem('nexusmd.calendar.reminderMins') || '10', 10));
}

function localDateStr(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function notify(title, body, tag) {
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body: (body || '').slice(0, 120),
      icon: '/favicon.ico',
      tag,
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'calendar' } }));
      n.close();
    };
  } catch (_) {}
}

// ── Core check ────────────────────────────────────────────────────

async function checkEvents() {
  if (Notification.permission !== 'granted') return;
  if (!GoogleAuth?.isConnected()) return;
  const token = GoogleAuth.getAuth()?.accessToken;
  if (!token) return;

  const now   = new Date();
  const today = localDateStr(now);

  // fetch today + tomorrow to catch events just after midnight
  const nextDay = new Date(now.getTime() + 86_400_000);

  try {
    const res = await fetch(
      `/api/google/calendar/events?token=${encodeURIComponent(token)}&start=${today}&end=${localDateStr(nextDay)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return;
    const events = await res.json();
    const mins = reminderMins();

    for (const ev of events) {
      // Skip all-day events (start is date-only, length 10)
      if (!ev.start || ev.start.length === 10) continue;

      const start     = new Date(ev.start);
      const msUntil   = start - now;
      const minsUntil = msUntil / 60_000;

      // ── Reminder alert (N minutes before) ──
      const remKey = `${ev.id}:remind:${mins}`;
      const remTarget = mins * 60_000; // ms before event
      if (msUntil > 0 && msUntil <= remTarget + WINDOW_MS && !notified.has(remKey)) {
        notified.add(remKey);
        const label = Math.round(minsUntil);
        notify(
          `In ${label} minute${label !== 1 ? 's' : ''}: ${ev.title}`,
          ev.location || '',
          remKey
        );
      }

      // ── Start alert (at event start) ──
      const startKey = `${ev.id}:start`;
      if (msUntil > -WINDOW_MS && msUntil <= WINDOW_MS && !notified.has(startKey)) {
        notified.add(startKey);
        notify(`Starting now: ${ev.title}`, ev.location || '', startKey);
      }
    }
  } catch (_) {}
}

// ── Lifecycle ─────────────────────────────────────────────────────

let timer = null;

function start() {
  if (timer || !('Notification' in window)) return;
  const run = () => { if (Notification.permission === 'granted') checkEvents(); };

  if (Notification.permission === 'granted') {
    checkEvents();
    timer = setInterval(run, CHECK_MS);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p !== 'granted') return;
      checkEvents();
      timer = setInterval(run, CHECK_MS);
    });
  }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Start/stop with Google auth state
document.addEventListener('google:auth:changed', e => {
  if (e.detail?.connected) start(); else stop();
});

// Start on load if already connected
function _init() {
  if (GoogleAuth?.isConnected()) start();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}

export const CalendarAlerts = { start, stop };
