'use strict';
// Joins a call a window made to what the main process did about it.
//
// While a recording runs, a window tells the main process which of its own calls is about to make an IPC call
// (`note`), just before it makes it. Messages from one window arrive in the order they were sent, so when the logged
// ipcMain then receives the call it takes that note (`take`) and puts what the handler does under the window's call.
// Nothing about any channel changes: no extra argument, no new field.

const FRAME_ID = /^[a-z][A-Za-z0-9]{0,15}-\d{1,12}$/;

/** @param {{ max?: number }} [opts]  `max`: notes kept per window and channel (a channel nobody takes from cannot grow) */
function createTraceLink({ max = 50 } = {}) {
  const pending = new Map(); // `${sender} ${channel}` -> frame ids, oldest first
  const keyOf = (sender, channel) => `${sender} ${channel}`;

  return {
    note(sender, channel, callId) {
      if (typeof callId !== 'string' || !FRAME_ID.test(callId) || typeof channel !== 'string' || sender == null) return;
      const key = keyOf(sender, channel);
      const queue = pending.get(key) ?? [];
      queue.push(callId);
      while (queue.length > max) queue.shift();
      pending.set(key, queue);
    },
    /** The window call noted for this window and channel, oldest first, or null. */
    take(sender, channel) {
      if (sender == null) return null;
      const key = keyOf(sender, channel);
      const queue = pending.get(key);
      if (!queue) return null;
      const id = queue.shift() ?? null;
      if (!queue.length) pending.delete(key);
      return id;
    },
    clear() { pending.clear(); },
  };
}

module.exports = { createTraceLink };
