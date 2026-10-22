// single-flight.js — wrap an async fn so overlapping calls coalesce. While one
// call is running, concurrent calls return { skipped: 'in-flight' } without
// invoking fn. The guard is set synchronously before the first await and
// cleared when the in-flight promise settles (resolve or reject).
export function singleFlight(fn) {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return { skipped: 'in-flight' };
    inFlight = true;
    try {
      return await fn(...args);
    } finally {
      inFlight = false;
    }
  };
}
