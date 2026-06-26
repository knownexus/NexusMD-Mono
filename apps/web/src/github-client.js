// github-client.js — Calls /api/github/* endpoints. Reads PAT from active profile config.

function getGitHubConfig() {
  try {
    const activeId = localStorage.getItem('nexusmd.activeProfileId');
    if (!activeId) return null;
    const raw = localStorage.getItem(`nexusmd.p.${activeId}.github.config`);
    if (!raw) return null;
    return JSON.parse(raw); // { pat, repos: string[] }
  } catch (_) { return null; }
}

async function ghFetch(path, extraParams = {}) {
  const cfg = getGitHubConfig();
  if (!cfg?.pat) throw new Error('GitHub PAT not configured.');
  const reposParam = (cfg.repos || []).join(',');
  const params = new URLSearchParams({ pat: cfg.pat, repos: reposParam, ...extraParams });
  const res = await fetch(`/api/github/${path}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 401) {
    document.dispatchEvent(new CustomEvent('nexusmd:token-expired', { detail: { service: 'github' } }));
    throw new Error('GitHub token expired.');
  }
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

export const GitHubClient = {
  getPullRequests: () => ghFetch('prs'),
  getIssues:       () => ghFetch('issues'),
  getWorkflowRuns: () => ghFetch('actions/runs'),
  getTeam:         () => ghFetch('team'),
  getRepos:        (org) => ghFetch('repos', org ? { org } : {}),
  startOAuth:      async () => {
    const { url } = await fetch('/api/github/auth/start').then(r => r.json());
    window.location.href = url;
  },
  completeOAuth:   (code) => fetch('/api/github/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).then(r => r.json()),
  isConfigured:    () => Boolean(getGitHubConfig()?.pat),
  getConfig:       () => getGitHubConfig(),
  saveConfig:      (cfg) => {
    try {
      const activeId = localStorage.getItem('nexusmd.activeProfileId');
      if (!activeId) return;
      localStorage.setItem(`nexusmd.p.${activeId}.github.config`, JSON.stringify(cfg));
    } catch (_) {}
  },
};
