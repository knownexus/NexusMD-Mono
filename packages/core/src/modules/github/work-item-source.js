// packages/core/src/modules/github/work-item-source.js — the shared detail view's GitHub source.
import { makeGithubClient } from './client.js'
import { parseGithubId } from '../workitems/ids.js'
import {
  loadGithubDetail, loadGithubComments, addGithubComment, updateGithubIssue,
  githubPatchFromAdoField, fetchGithubCreateMeta, createGithubIssue,
} from './issues.js'

export function makeGithubWorkItemSource({ http, getLogin = () => '' } = {}) {
  const client = makeGithubClient(http)
  return {
    getLogin,
    loadDetail: (id) => loadGithubDetail(client, id),
    loadComments: (id) => loadGithubComments(client, id),
    addComment: (id, _project, html) => addGithubComment(client, id, html),
    loadRawFields: (id) => {
      const { repo, number } = parseGithubId(id) || {}
      if (!repo) throw new Error(`Not a GitHub issue id: ${id}`)
      return client.get(`repos/${repo}/issues/${number}`)
    },
    saveField: (id, field, value) => updateGithubIssue(client, id, githubPatchFromAdoField(field, value)),
    moveToCategory: (id, category) => updateGithubIssue(client, id,
      category === 'Completed' ? { state: 'closed', state_reason: 'completed' } : { state: 'open' }),
    availableTargetStates: async () => ['Open', 'Closed'],
    webUrl: (item) => {
      const p = parseGithubId(item.id)
      return p ? `https://github.com/${p.repo}/issues/${p.number}` : ''
    },
    getCreateMeta: (repo) => fetchGithubCreateMeta(client, repo),
    createIssue: (input) => createGithubIssue(client, input),
  }
}
