// install.js — makes a window part of a recording: when the main process says one is running, the window starts recording
// what it does and sends it over; it also notes clicks and network requests (clicks.js, fetch-capture.js).
//
//   installWindowRecording()   // once, when the window starts (apps/desktop/src/main.jsx)
//
// The preload (apps/desktop/electron/preload.cjs) cannot see this page's code, so the page hands it a function that says which
// of its calls is running. That function also sends what has been recorded so far first: messages from one window arrive in
// order, so the call's start reaches the main process before the IPC call it is about to make.
import { installClickCapture, accessibleName } from './clicks.js';
import { installFetchCapture } from './fetch-capture.js';
import { startShipper } from './shipper.js';

/**
 * @param {{ api?: object, doc?: Document, getPage?: () => string }} [opts]
 * @returns {() => void} uninstall
 */
export function installWindowRecording({ api = typeof window !== 'undefined' ? window.electronAPI : undefined, doc = typeof document !== 'undefined' ? document : undefined, getPage } = {}) {
  const trace = api?.trace;
  const runtime = globalThis.__nxt;
  if (!trace || !runtime || !doc) return () => {};

  const page = getPage ?? (() => { const el = doc.querySelector('[aria-current="page"]'); return el ? accessibleName(el) : ''; });
  const removals = [installClickCapture(doc, page), installFetchCapture(doc.defaultView ?? window)];
  let shipper = null;
  let disposed = false;

  const apply = (state) => {
    if (disposed) return;
    const want = !!state?.recording;
    if (want && !shipper) {
      runtime.start({ proc: 'renderer', win: state.win });
      shipper = startShipper({ send: (events) => trace.push(events) });
    } else if (!want && shipper) {
      runtime.stop();
      shipper();
      shipper = null;
    }
  };

  trace.setContextProvider(() => { shipper?.flush(); return runtime.current(); });
  const unsubscribe = trace.onState(apply);
  apply(trace.state());

  return () => {
    disposed = true;
    unsubscribe?.();
    for (const remove of removals) remove();
    if (shipper) { runtime.stop(); shipper(); shipper = null; }
    trace.setContextProvider(null);
  };
}
