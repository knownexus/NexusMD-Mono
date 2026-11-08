// disconnect.js — removes a service's connection from the active profile: its saved settings, its
// token and any sign-in, and the data cached from it. Without this a service could only be
// blanked field by field (the token never), and its PRs, builds and items stayed on screen.
import { core, clearProviderData, rendererLog } from '@nexusmd/core'
import { getProfileKey, profileSecrets } from '@nexusmd/shell-sdk'
import { WI_TYPE_STATES_CACHE_KEY } from '@nexusmd/ui'
import { removeAdoConfig } from './ado-client.js'
import { removeJiraConfig } from './jira-client.js'
import { removeGithubConfig } from './github-client.js'
import { workStorage } from './work-storage.js'

const log = rendererLog('work', 'disconnect')

// Looked up when called, not at load, so a screen that mocks one client doesn't need the others.
const removerOf = (id) => ({ ado: () => removeAdoConfig(), jira: () => removeJiraConfig(), github: () => removeGithubConfig() })[id]
// Services that can also be signed in to with OAuth (stored as `<id>.auth`); Jira only has a token.
const HAS_SIGN_IN = new Set(['ado', 'github'])

export function disconnectProvider(id) {
  const remove = removerOf(id)
  if (!remove) throw new Error(`disconnectProvider: unknown provider "${id}"`)
  remove()
  clearProviderData(workStorage, id)
  if (HAS_SIGN_IN.has(id)) {
    profileSecrets.remove(getProfileKey(`${id}.auth`)).catch(err => log.warn('could not remove the sign-in', err))
  }
  try {
    if (id === 'ado') localStorage.removeItem(WI_TYPE_STATES_CACHE_KEY)
    if (id === 'github') {
      // What the older GitHub card kept; GithubConnectionCard reads it as a token fallback.
      localStorage.removeItem(getProfileKey('nexusmd.github.pat'))
      localStorage.removeItem(getProfileKey('nexusmd.github.repos'))
    }
  } catch (err) { log.warn('could not remove the older keys', err) }
  core._emit?.('data:updated')
}
