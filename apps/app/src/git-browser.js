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
