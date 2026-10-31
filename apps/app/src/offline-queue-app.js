// offline-queue-app.js — the app's offline queue: the handlers that really send a state change, a PR
// vote or a PR comment, the event the UI listens to for the number waiting, and the flush that runs
// when the connection returns (and shortly after start).
import { makeGithubClient } from '@nexusmd/core';
import { createOfflineQueue } from './offline-queue.js';
import { workItemSource } from './work-item-source.js';
import { adoPost, adoPut } from './ado-client.js';
import { createGithubHttpAdapter } from './github-client.js';
import { adoVote, adoComment, githubVote, githubComment } from './pr-actions-phone.js';
import { getProfileKey } from './profile-keys.js';

const gh = () => makeGithubClient(createGithubHttpAdapter());

export const appQueue = createOfflineQueue({
  storage: localStorage,
  key: () => getProfileKey('helm.offlineQueue'),
  handlers: {
    'wi.state': ({ id, state }) => workItemSource.saveField(id, 'System.State', state),
    'pr.vote': ({ pr, vote, adoId }) => (pr.source === 'github' ? githubVote(gh(), pr, vote) : adoVote({ put: adoPut }, pr, adoId, vote)),
    'pr.comment': ({ pr, text }) => (pr.source === 'github' ? githubComment(gh(), pr, text) : adoComment({ post: adoPost }, pr, text)),
  },
  emit: (count) => window.dispatchEvent(new CustomEvent('helm:queue', { detail: { count } })),
});

export async function flushQueue() {
  const r = await appQueue.flush();
  if (r.sent || r.failed.length) window.dispatchEvent(new CustomEvent('helm:queue-flushed', { detail: r }));
  return r;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
  setTimeout(() => { flushQueue(); }, 3000);
}
