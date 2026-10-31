// git-backend.js — one read-only repository API over both providers, so the Repos screen does not
// care whether a repo lives in Azure DevOps or GitHub. Paths keep ADO's shape in the UI ('/' root,
// '/dir/file'); the GitHub side translates them. A repo is { id, name, project, defaultBranch,
// provider } where `project` is the ADO project or the GitHub owner.
import {
  makeGithubClient, listGithubBranches, listGithubCommits, listGithubContents, getGithubFile,
} from '@nexusmd/core';
import { listRepos as listAdoRepos, listBranches as listAdoBranches, listCommits as listAdoCommits,
  listItems as listAdoItems, getFile as getAdoFile } from './git-browser.js';

export const isGithubRepo = (repo) => repo?.provider === 'github';
export const providerName = (repo) => (isGithubRepo(repo) ? 'GitHub' : 'Azure DevOps');

// The repositories ticked in the GitHub settings, as repo objects.
export function githubReposFromConfig(config) {
  return (config?.repos || []).map(full => {
    const [owner, name] = String(full).split('/');
    return { id: `gh:${full}`, name, project: owner, fullName: full, defaultBranch: '', provider: 'github' };
  });
}

const noLead = (p) => String(p || '').replace(/^\/+/, '');

export function makeGitBackend({ adoGet, getAdoProjects, githubHttp, getGithubConfig, isGithubConfigured }) {
  const gh = () => makeGithubClient(githubHttp);

  return {
    // Either provider may be missing or failing: the other's repos still list. Errors come back
    // alongside so the screen can say which provider failed.
    async listRepos() {
      const errors = [];
      const ado = (getAdoProjects() || []).length
        ? await listAdoRepos(adoGet, getAdoProjects()).then(r => r.map(x => ({ ...x, provider: 'ado' })), e => { errors.push(e); return []; })
        : [];
      const github = isGithubConfigured() ? githubReposFromConfig(getGithubConfig()) : [];
      return { repos: [...ado, ...github], errors };
    },

    async listBranches(repo) {
      if (!isGithubRepo(repo)) return listAdoBranches(adoGet, repo);
      return (await listGithubBranches(gh(), repo.fullName)).map(b => ({ name: b.name, isDefault: b.isDefault }));
    },

    async listCommits(repo, branch) {
      if (!isGithubRepo(repo)) return listAdoCommits(adoGet, repo, branch);
      return (await listGithubCommits(gh(), repo.fullName, branch)).map(c => ({
        id: c.sha, shortId: String(c.sha).slice(0, 8), message: c.message, author: c.author, date: c.date,
        url: `https://github.com/${repo.fullName}/commit/${c.sha}`,
      }));
    },

    async listItems(repo, branch, path = '/') {
      if (!isGithubRepo(repo)) return listAdoItems(adoGet, repo, branch, path);
      return (await listGithubContents(gh(), repo.fullName, { path: noLead(path), ref: branch })).map(i => ({
        path: '/' + i.path, name: i.name, isFolder: i.type === 'dir',
      }));
    },

    async getFile(repo, branch, path) {
      if (!isGithubRepo(repo)) return getAdoFile(adoGet, repo, branch, path);
      const f = await getGithubFile(gh(), repo.fullName, { path: noLead(path), ref: branch });
      if (f.text == null) throw new Error(f.reason === 'too-large' ? 'That file is too large to show here.' : 'Only text files can be shown here.');
      return f.text;
    },
  };
}

// The providers that have repos, in a fixed order, and which one to show: the saved choice if it
// still has repos, otherwise the first that does.
export const SOURCE_ORDER = ['ado', 'github'];
export const sourcesOf = (repos) => SOURCE_ORDER.filter(p => (repos || []).some(r => (r.provider || 'ado') === p));
export const pickSource = (saved, available) => (available.includes(saved) ? saved : available[0] || null);
export const sourceLabel = (p) => (p === 'github' ? 'GitHub' : 'Azure DevOps');
