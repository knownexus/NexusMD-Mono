// Session caches for the commits browser and the queue every history request goes through.
// Commits never change, so anything keyed by a commit id is cached for the session. The queue
// caps history at two requests in flight: main runs at most six git processes, and the 10 s
// status polls must not wait behind a burst of history reads.

export function createLru(max) {
  const map = new Map()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key)
      map.delete(key)
      map.set(key, value)
      return value
    },
    has(key) { return map.has(key) },
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      while (map.size > max) map.delete(map.keys().next().value)
    },
    delete(key) { map.delete(key) },
    clear() { map.clear() },
    get size() { return map.size },
  }
}

export const CANCELLED = 'cancelled'

/**
 * Runs at most `concurrency` jobs at once. A job with the same key as one already queued or
 * running shares its promise. `focus` jobs start before `prefetch` jobs; `cancel(pred)` drops
 * queued (never running) jobs, rejecting them with an error whose `cancelled` is true.
 */
export function createQueue(concurrency = 2) {
  const pending = []
  const shared = new Map()
  let running = 0
  const pump = () => {
    while (running < concurrency && pending.length) {
      const i = pending.findIndex(j => j.priority === 'focus')
      const job = pending.splice(i >= 0 ? i : 0, 1)[0]
      running++
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          running--
          shared.delete(job.key)
          pump()
        })
    }
  }
  return {
    run(key, fn, { priority = 'focus', tag = null } = {}) {
      if (shared.has(key)) {
        // A prefetch the user has now focused jumps the queue.
        const queued = pending.find(j => j.key === key)
        if (queued && priority === 'focus') queued.priority = 'focus'
        return shared.get(key)
      }
      let job
      const promise = new Promise((resolve, reject) => { job = { key, fn, priority, tag, resolve, reject } })
      pending.push(job)
      shared.set(key, promise)
      pump()
      return promise
    },
    cancel(pred) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (!pred(pending[i])) continue
        const [job] = pending.splice(i, 1)
        shared.delete(job.key)
        job.reject(Object.assign(new Error(CANCELLED), { cancelled: true }))
      }
    },
    get running() { return running },
    get queued() { return pending.length },
  }
}

export function createHistoryCache() {
  return {
    details: createLru(500),
    files: createLru(500),
    diffs: createLru(200),
    pages: createLru(50),
    queue: createQueue(2),
  }
}

// Shared by every History view, so switching worktrees or tabs keeps what was loaded.
export const historyCache = createHistoryCache()
