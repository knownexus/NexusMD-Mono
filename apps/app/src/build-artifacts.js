// build-artifacts.js — list a build's artifacts and save one to the device, for Azure DevOps builds
// (build artifacts, always served as a zip) and GitHub Actions runs (run artifacts, also a zip). The
// download itself is the ArtifactDownload native plugin: it asks where to save and streams the zip there.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { createAdoHttpAdapter, getAdoConfig } from './ado-client.js';
import { createGithubHttpAdapter, getGithubConfig } from './github-client.js';

export const artifactPlugin = registerPlugin('ArtifactDownload');
export const downloadsSupported = () => Capacitor.isNativePlatform();

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

export async function listArtifacts(build, {
  ado = createAdoHttpAdapter(), github = createGithubHttpAdapter(), org = getAdoConfig().org,
} = {}) {
  if (build.source === 'github') {
    const r = await github.fetch(`repos/${build.projectName}/actions/runs/${build.id}/artifacts?per_page=100`);
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return mapGithubArtifacts(await r.json());
  }
  const r = await ado.fetch(`${encodeURIComponent(build.projectName || build.project)}/_apis/build/builds/${build.id}/artifacts?api-version=7.0`);
  if (!r.ok) throw new Error(`Azure DevOps answered ${r.status}`);
  return mapAdoArtifacts(await r.json(), build, org);
}

// The provider's own auth, sent only to its API host by the plugin.
export function authHeaders(provider, { ado = getAdoConfig(), github = getGithubConfig() } = {}) {
  if (provider === 'github') {
    return { Authorization: 'Bearer ' + github.pat, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  return { Authorization: 'Basic ' + btoa(':' + ado.pat), Accept: '*/*' };
}

// -> { cancelled: true } | { bytes, uri }
export const saveArtifact = (item, { plugin = artifactPlugin, headers = authHeaders(item.provider) } = {}) =>
  plugin.save({ url: item.url, filename: item.filename, headers });
