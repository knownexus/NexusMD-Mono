// What a host with an offline queue (desktop) says when a write was kept for later, the same words
// as the phone app. Hosts give shared views the queue as `offlineQueue` in the data context:
// run(kind, payload, label) -> { done, result } | { queued: true }. With none (web), views call the
// provider directly as before.
export const QUEUED_TOAST = "Saved. It will be sent when you're back online."
