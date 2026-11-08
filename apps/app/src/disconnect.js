// disconnect.js — removes a service's connection from the active profile on the phone: its saved
// settings and token, any sign-in, and the data cached from it. Without this a connection could
// only be blanked field by field (the token never) and its PRs and items stayed on screen.
import { clearProviderData } from '@nexusmd/core';
import { localStorageAdapter } from '@nexusmd/web-adapters';
import { removeAdoConfig } from './ado-client.js';
import { removeJiraConfig } from './jira-client.js';
import { removeGithubConfig } from './github-client.js';
import { makeAppOAuthService } from './cloud-auth.js';

// Looked up when called, so a screen that mocks one client doesn't need the others.
const removerOf = (id) => ({ ado: () => removeAdoConfig(), jira: () => removeJiraConfig(), github: () => removeGithubConfig() })[id];
// Services that can also be signed in to with OAuth; Jira only has a token.
const HAS_SIGN_IN = new Set(['ado', 'github']);

export function disconnectProvider(id) {
  const remove = removerOf(id);
  if (!remove) throw new Error(`disconnectProvider: unknown provider "${id}"`);
  remove();
  clearProviderData(localStorageAdapter, id);
  if (HAS_SIGN_IN.has(id)) {
    makeAppOAuthService(id).disconnect?.()?.catch?.((e) => console.warn('[disconnect] could not remove the sign-in', e));
  }
  // Reload: with nothing left connected this empties what the screens show (see data.jsx).
  window.HelmApi?.load?.().catch?.(() => {});
}
