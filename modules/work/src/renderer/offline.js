// offline.js — Work's side of the desktop offline queue. The shell owns the queue (host.offlineQueue)
// but not the ADO and GitHub clients, so Work provides the sender the queue's handlers call
// ('work.offlineSend'), and routes its PR votes and work-item state changes through the queue.
// PR comments go through it in the shared PR tabs, which read the queue from the data context.
//
// Only network failures are kept; anything the provider rejects is thrown to the caller, as before.
// Reject and merge are never queued: sending them later could surprise whoever reviews in between.
import { voteAdoPR, reviewGithubPR, postPRThread, postGithubPRComment, makeGithubClient } from '@nexusmd/core'
import { toast, QUEUED_TOAST } from '@nexusmd/ui'

// What is kept for a queued call: only what it needs.
const adoRef = pr => ({ id: pr.id, project: pr.project, repoId: pr.repoId })
const ghRef = pr => ({ repo: pr.repo, number: pr.number })
const prLabel = pr => pr.displayId || (pr.source === 'github' ? `${pr.repo}#${pr.number}` : `#${pr.id}`)
const itemRef = item => (item ? { id: item.id, type: item.type, state: item.state, project: item.project } : item)

// The sender for each queued kind. `githubHttp` and `workItemSource` are read when sending, so a
// change of settings (or of the routed source) since the write was queued is honoured.
export function makeOfflineSender({ adoHttp, githubHttp, workItemSource }) {
  const gh = () => {
    const http = githubHttp()
    if (!http) throw new Error('GitHub is not configured')
    return makeGithubClient(http)
  }
  const senders = {
    'ado-vote': ({ pr, vote, adoId }) => voteAdoPR(adoHttp, { project: pr.project, repoId: pr.repoId, prId: pr.id, reviewerId: adoId }, vote),
    'ado-comment': ({ pr, text }) => postPRThread(adoHttp, { project: pr.project, repoId: pr.repoId, prId: pr.id, content: text }),
    'github-vote': ({ pr, event }) => reviewGithubPR(gh(), ghRef(pr), event),
    'github-comment': ({ pr, text }) => postGithubPRComment(gh(), ghRef(pr), text),
    'work-state': ({ id, state, category, item }) => (category
      ? workItemSource().moveToCategory(id, category, item)
      : workItemSource().saveField(id, 'System.State', state)),
  }
  return async (kind, payload) => {
    if (!senders[kind]) throw new Error(`Unknown offline action: ${kind}`)
    return senders[kind](payload)
  }
}

// makePRActions with Approve and Wait for author sent through the queue. A queued vote resolves
// like a sent one, plus `queued: true` (PRActions then shows the queued toast).
export function withQueuedVotes(actions, queue, { adoMeId }) {
  async function vote(pr, adoVote, event) {
    const github = pr?.source === 'github'
    // Refused before queueing, exactly as the direct call refuses it.
    if (!github && !adoMeId) throw new Error('Your Azure DevOps identity is not known yet — refresh and try again')
    const r = await queue.run(
      github ? 'github-vote' : 'ado-vote',
      github ? { pr: ghRef(pr), event } : { pr: adoRef(pr), vote: adoVote, adoId: adoMeId },
      `Vote on ${prLabel(pr)}`,
    )
    return { patch: { myVote: adoVote }, warnings: [], ...(r.queued ? { queued: true } : {}) }
  }
  return {
    ...actions,
    approve: pr => vote(pr, 10, 'APPROVE'),
    waitForAuthor: pr => vote(pr, -5, 'REQUEST_CHANGES'),
  }
}

// The work-item source with state changes (System.State saves and moves between categories) sent
// through the queue. Callers get what they always got; a queued change shows the queued toast, and a
// queued move answers with the target category (the real state arrives with the next refresh).
export function withQueuedStateChanges(source, queue) {
  const wrapped = {
    ...source,
    async saveField(id, field, value) {
      if (field !== 'System.State') return source.saveField(id, field, value)
      const r = await queue.run('work-state', { id, state: value }, `Move ${id} to ${value}`)
      if (r.queued) { toast?.(QUEUED_TOAST, 'success'); return undefined }
      return r.result
    },
  }
  if (source.moveToCategory) {
    wrapped.moveToCategory = async (id, category, item) => {
      const r = await queue.run('work-state', { id, category, item: itemRef(item) }, `Move ${id} to ${category}`)
      if (!r.queued) return r.result
      toast?.(QUEUED_TOAST, 'success')
      return { state: item?.state, stateCategory: category, queued: true }
    }
  }
  return wrapped
}
