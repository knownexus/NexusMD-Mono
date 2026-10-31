// git-browser.js — read-only Azure DevOps repository browsing for the Android app: repos, branches
// and recent commits over the REST API. Android has no git CLI to run the desktop Git Workspace
// against, so this covers looking around; changes still happen on the desktop or through PRs.
// `get(path)` is the ADO GET (ado-client's adoGet), injected so these stay testable.

const enc = encodeURIComponent;

export async function listRepos(get, projects = []) {
  const perProject = await Promise.all(projects.map(async (project) => {
    const r = await get(`${enc(project)}/_apis/git/repositories?api-version=7.0`);
    return (r?.value || [])
      .filter(repo => !repo.isDisabled)
      .map(repo => ({
        id: repo.id, name: repo.name, project,
        defaultBranch: String(repo.defaultBranch || '').replace(/^refs\/heads\//, ''),
      }));
  }));
  return perProject.flat().sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
}

// Default branch first, then alphabetical.
export async function listBranches(get, repo) {
  const r = await get(`${enc(repo.project)}/_apis/git/repositories/${repo.id}/refs?filter=heads/&api-version=7.0`);
  return (r?.value || [])
    .map(ref => ({ name: ref.name.replace(/^refs\/heads\//, ''), objectId: ref.objectId }))
    .map(b => ({ ...b, isDefault: b.name === repo.defaultBranch }))
    .sort((a, b) => (b.isDefault - a.isDefault) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function listCommits(get, repo, branch, top = 50) {
  const q = `searchCriteria.itemVersion.version=${enc(branch)}&searchCriteria.itemVersion.versionType=branch&searchCriteria.$top=${top}`;
  const r = await get(`${enc(repo.project)}/_apis/git/repositories/${repo.id}/commits?${q}&api-version=7.0`);
  return (r?.value || []).map(c => ({
    id: c.commitId,
    shortId: String(c.commitId).slice(0, 8),
    message: String(c.comment || '').split('\n')[0],
    author: c.author?.name || '',
    date: c.author?.date || '',
    url: c.remoteUrl || '',
  }));
}

const at = (branch) => `versionDescriptor.version=${enc(branch)}&versionDescriptor.versionType=branch`;

// One folder level, folders first. `path` is '/' for the root.
export async function listItems(get, repo, branch, path = '/') {
  const r = await get(`${enc(repo.project)}/_apis/git/repositories/${repo.id}/items?scopePath=${enc(path)}&recursionLevel=OneLevel&${at(branch)}&api-version=7.0`);
  return (r?.value || [])
    .filter(i => i.path !== path && i.path !== path.replace(/\/$/, ''))
    .map(i => ({ path: i.path, name: i.path.split('/').pop(), isFolder: !!i.isFolder }))
    .sort((a, b) => (b.isFolder - a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Text content of one file.
export async function getFile(get, repo, branch, path) {
  const r = await get(`${enc(repo.project)}/_apis/git/repositories/${repo.id}/items?path=${enc(path)}&includeContent=true&${at(branch)}&api-version=7.0`);
  return typeof r === 'string' ? r : String(r?.content ?? '');
}

// Commits grouped by local calendar day, newest first (input order kept within a day).
export function groupCommitsByDay(commits) {
  const groups = [];
  for (const c of commits) {
    const day = c.date ? new Date(c.date).toDateString() : 'Unknown date';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.commits.push(c); else groups.push({ day, commits: [c] });
  }
  return groups;
}
