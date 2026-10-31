// pr-actions-phone.js — voting on and commenting on a pull request from the phone sheet, for both
// providers. Pure: the ADO calls and the GitHub client are passed in.
import { reviewGithubPR, postGithubPRComment } from '@nexusmd/core';

const enc = encodeURIComponent;

export const ADO_VOTES = [
  { v: 10, label: 'Approve' },
  { v: 5, label: 'Approve with suggestions' },
  { v: -5, label: 'Wait for author' },
  { v: -10, label: 'Reject' },
];
export const GITHUB_VOTES = [
  { v: 'APPROVE', label: 'Approve' },
  { v: 'REQUEST_CHANGES', label: 'Request changes' },
];
export const adoVoteLabel = (v) => ({ 10: 'Approved', 5: 'Approved with suggestions', '-5': 'Waiting for author', '-10': 'Rejected' }[String(v)] || 'No vote');

export const votesFor = (pr) => (pr?.source === 'github' ? GITHUB_VOTES : ADO_VOTES);

// Open and not a draft; ADO also needs the repo and your ADO identity to vote as.
export function canVote(pr, me) {
  if (!pr || pr.status !== 'active' || pr.draft) return false;
  return pr.source === 'github' ? true : !!(pr.repoId && pr.project && me?.adoId);
}
export const canComment = (pr) => !!pr && (pr.source === 'github' || !!(pr.repoId && pr.project));

// Your current vote, from the reviewer list (ADO matches your identity; GitHub, your login).
export function myVoteOf(pr, me, githubLogin = '') {
  const list = pr?.reviewerDetails || [];
  const mine = pr?.source === 'github'
    ? list.find(r => githubLogin && String(r.name).toLowerCase() === githubLogin.toLowerCase())
    : list.find(r => me?.adoId && r.id === me.adoId) || list.find(r => me?.name && r.name === me.name);
  return mine?.vote ?? 0;
}

const prPath = (pr) => `${enc(pr.project)}/_apis/git/repositories/${pr.repoId}/pullRequests/${pr.id}`;

export const adoVote = ({ put }, pr, adoId, vote) => put(`${prPath(pr)}/reviewers/${adoId}?api-version=7.0`, { vote });
export const adoComment = ({ post }, pr, text) =>
  post(`${prPath(pr)}/threads?api-version=7.0`, { comments: [{ parentCommentId: 0, content: text, commentType: 1 }], status: 1 });

// What is kept for a queued action: only what the call needs.
export const minimalPR = (pr) => ({
  id: pr.id, source: pr.source || 'ado', project: pr.project, repoId: pr.repoId, repo: pr.repo, number: pr.number,
});

// Your Azure DevOps identity, when the loaded data doesn't carry it: asked once, then remembered.
let identity = null;
export function resolveAdoId(adoGet) {
  if (!identity) {
    identity = adoGet('_apis/connectionData')
      .then(r => r?.authenticatedUser?.id || '')
      .catch(() => { identity = null; return ''; });
  }
  return identity;
}
export const resetAdoIdentity = () => { identity = null; };

export const githubVote = (client, pr, event) => reviewGithubPR(client, { repo: pr.repo, number: pr.number }, event);
export const githubComment = (client, pr, text) => postGithubPRComment(client, pr, text);
