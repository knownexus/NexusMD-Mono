// offline-queue.js — provider writes (state changes, PR votes and comments) made while offline are
// kept and sent when the connection is back. Pure: storage, the clock and the network check are
// injected, and the handlers do the real work.
export const isNetworkError = (e) => e instanceof TypeError || /failed to fetch|network|timed? ?out|offline|ERR_/i.test(String(e?.message || ''));

export function createOfflineQueue({
  storage, key, handlers, isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  now = Date.now, emit = () => {},
}) {
  const read = () => { try { const l = JSON.parse(storage.getItem(key()) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
  const write = (list) => { try { storage.setItem(key(), JSON.stringify(list)); } catch { /* storage full */ } emit(list.length); };
  const remove = (id) => write(read().filter(o => o.id !== id));
  const count = () => read().length;

  function enqueue(kind, payload, label = '') {
    const op = { id: `${now()}_${Math.random().toString(36).slice(2, 8)}`, kind, payload, label, at: now() };
    write([...read(), op]);
    return op;
  }

  // Runs now when online; when offline (or the network drops mid-request) keeps it for later.
  // Any other failure (the provider said no) is thrown for the caller to show.
  async function run(kind, payload, label = '') {
    if (!handlers[kind]) throw new Error(`Unknown action: ${kind}`);
    if (isOnline()) {
      try { return { done: true, result: await handlers[kind](payload) }; } catch (e) { if (!isNetworkError(e)) throw e; }
    }
    return { queued: true, op: enqueue(kind, payload, label) };
  }

  let flushing = false;
  // Sends what is waiting, oldest first. Stops at the first network failure (still offline); an
  // operation the provider rejects is dropped and reported so it cannot block the rest.
  async function flush() {
    const out = { sent: 0, failed: [] };
    if (flushing || !isOnline()) return out;
    flushing = true;
    try {
      for (const op of read()) {
        try { await handlers[op.kind](op.payload); remove(op.id); out.sent++; }
        catch (e) {
          if (isNetworkError(e)) break;
          remove(op.id); out.failed.push({ op, error: e });
        }
      }
    } finally { flushing = false; }
    return out;
  }

  return { enqueue, run, flush, count, list: read };
}
