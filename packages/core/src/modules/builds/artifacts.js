// artifacts.js — list a build's artifacts, for Azure DevOps builds (build artifacts, always served as a
// zip) and GitHub Actions runs (run artifacts, also a zip). Pure: the HTTP clients and the provider
// configs are passed in. Saving the file is the platform's job (mobile: the ArtifactDownload native
// plugin; desktop: the main process's artifacts:save).

const safeName = (s) => String(s || 'artifact').replace(/[^\w.\- ]+/g, '_').slice(0, 80);

export function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

// -> [{ provider, name, size, url, filename, expired }]
export function mapAdoArtifacts(raw, build, org) {
  return (raw?.value || []).map(a => ({
    provider: 'ado',
    name: a.name,
    size: Number(a.resource?.properties?.artifactsize) || 0,
    // Built here rather than taken from downloadUrl so the request always goes to the configured org.
    url: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(build.projectName || build.project)}/_apis/build/builds/${build.id}/artifacts`
      + `?artifactName=${encodeURIComponent(a.name)}&api-version=7.0&%24format=zip`,
    filename: `${safeName(a.name)}.zip`,
    expired: false,
  }));
}

export function mapGithubArtifacts(raw) {
  return (raw?.artifacts || []).map(a => ({
    provider: 'github',
    name: a.name,
    size: a.size_in_bytes || 0,
    url: a.archive_download_url,
    filename: `${safeName(a.name)}.zip`,
    expired: !!a.expired,
  }));
}

// deps: { ado, github } HTTP adapters ({ fetch(path) }) and the ADO org.
export async function listArtifacts(build, { ado, github, org } = {}) {
  if (build.source === 'github') {
    const r = await github.fetch(`repos/${build.projectName}/actions/runs/${build.id}/artifacts?per_page=100`);
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return mapGithubArtifacts(await r.json());
  }
  const r = await ado.fetch(`${encodeURIComponent(build.projectName || build.project)}/_apis/build/builds/${build.id}/artifacts?api-version=7.0`);
  if (!r.ok) throw new Error(`Azure DevOps answered ${r.status}`);
  return mapAdoArtifacts(await r.json(), build, org);
}

// The only hosts a provider's token may go to. Both are https-only cloud hosts (ADO here is always
// dev.azure.com/{org}; there is no on-prem server URL), so plain http never gets a token.
export const ARTIFACT_API_ORIGINS = { ado: 'https://dev.azure.com', github: 'https://api.github.com' };

// Whether `url` is on the provider's own API origin (and, for ADO, under the configured org).
export function isArtifactApiUrl(provider, url, { org } = {}) {
  const origin = ARTIFACT_API_ORIGINS[provider];
  if (!origin) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== origin) return false;
  if (provider === 'ado' && org) return u.pathname.startsWith(`/${encodeURIComponent(org)}/`);
  return true;
}

// The provider's own auth. Given a `url`, nothing is returned unless the URL is on that provider's API
// origin, so the token never goes to another host.
export function authHeaders(provider, { ado = {}, github = {}, url } = {}) {
  if (url !== undefined && !isArtifactApiUrl(provider, url, { org: ado.org })) return {};
  if (provider === 'github') {
    return { Authorization: 'Bearer ' + github.pat, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  return { Authorization: 'Basic ' + btoa(':' + ado.pat), Accept: '*/*' };
}
