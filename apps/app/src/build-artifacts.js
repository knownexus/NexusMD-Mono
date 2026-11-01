// build-artifacts.js — list a build's artifacts and save one to the device. Listing and the per-provider
// auth are shared (@nexusmd/core); this file wires them to the app's own clients and configs. The
// download itself is the ArtifactDownload native plugin: it asks where to save and streams the zip there.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { listArtifacts as listFrom, authHeaders as authFor } from '@nexusmd/core';
import { createAdoHttpAdapter, getAdoConfig } from './ado-client.js';
import { createGithubHttpAdapter, getGithubConfig } from './github-client.js';

export const artifactPlugin = registerPlugin('ArtifactDownload');
export const downloadsSupported = () => Capacitor.isNativePlatform();

export const listArtifacts = (build, deps = {}) => listFrom(build, {
  ado: createAdoHttpAdapter(), github: createGithubHttpAdapter(), org: getAdoConfig().org, ...deps,
});

// The provider's own auth, only for its API host (the plugin also drops it on a redirect elsewhere).
export const authHeaders = (provider, url) => authFor(provider, { ado: getAdoConfig(), github: getGithubConfig(), url });

// -> { cancelled: true } | { bytes, uri }
export const saveArtifact = (item, { plugin = artifactPlugin, headers = authHeaders(item.provider, item.url) } = {}) =>
  plugin.save({ url: item.url, filename: item.filename, headers });
