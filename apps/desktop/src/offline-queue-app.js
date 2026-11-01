// offline-queue-app.js — desktop's offline queue: PR votes, PR comments and work-item state changes
// made with no connection are kept (per profile, on this machine) and sent when it returns.
//
// The shell owns the queue, but the ADO and GitHub clients belong to the Work app, which the shell
// never imports (it may not be installed). So every handler sends through the Work app's
// `work.offlineSend` capability. Until Work has provided it, a send fails as a network error, so
// what is waiting stays queued instead of being dropped.
import { createOfflineQueue } from '@nexusmd/core'
import { getProfileKey } from './profile-keys.js'
import { capabilities } from './shell/capabilities.js'

export const QUEUE_KINDS = ['ado-vote', 'ado-comment', 'github-vote', 'github-comment', 'work-state']
export const SEND_CAPABILITY = 'work.offlineSend'

// Pure: storage, key, the network check and the sender are injected.
export function makeDesktopQueue({ storage, key, send, isOnline, emit }) {
  const handlers = Object.fromEntries(QUEUE_KINDS.map(kind => [kind, payload => send(kind, payload)]))
  return createOfflineQueue({ storage, key, handlers, ...(isOnline ? { isOnline } : {}), ...(emit ? { emit } : {}) })
}

async function sendThroughWork(kind, payload) {
  if (!capabilities.has(SEND_CAPABILITY)) throw new TypeError('The Work app is not ready to send yet (offline)')
  return capabilities.call(SEND_CAPABILITY, kind, payload)
}

export const appQueue = makeDesktopQueue({
  storage: localStorage,
  key: () => getProfileKey('nexusmd.offlineQueue'),
  send: sendThroughWork,
  emit: count => window.dispatchEvent(new CustomEvent('nexusmd:queue', { detail: { count } })),
})

export async function flushQueue() {
  const r = await appQueue.flush()
  if (r.sent || r.failed.length) window.dispatchEvent(new CustomEvent('nexusmd:queue-flushed', { detail: r }))
  return r
}

// Flush when the connection returns and shortly after start (main.jsx calls this once).
export function startQueueFlushing({ delay = 3000 } = {}) {
  window.addEventListener('online', () => { flushQueue() })
  setTimeout(() => { flushQueue() }, delay)
}
