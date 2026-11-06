// shipper.js — sends what this window has recorded to the main process, which owns the recording.
//
//   const stop = startShipper({ send: (events) => electronAPI.trace.push(events) })
//   stop.flush()   // send what there is now
//   stop()         // send the last of it and stop
import { rendererLog, ignore } from '../log.js';

const log = rendererLog('core', 'trace-shipper');

/** @param {{ send: (events: object[]) => void, everyMs?: number }} opts  @returns {(() => void) & { flush: () => void }} */
export function startShipper({ send, everyMs = 500 }) {
  const flush = () => {
    try {
      const batch = globalThis.__nxt?.drain?.() ?? [];
      if (batch.length) send(batch);
    } catch (err) { ignore(log, 'a batch of recorded calls could not be sent to the main process', err); }
  };
  const timer = setInterval(flush, everyMs);
  const stop = () => { clearInterval(timer); flush(); };
  stop.flush = flush;
  return stop;
}
