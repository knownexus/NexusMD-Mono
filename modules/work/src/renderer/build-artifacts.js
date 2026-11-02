// build-artifacts.js — the Builds drawer's artifacts (BuildDetail reads it as `buildArtifacts` from the
// NexusData context). Listing uses Work's own ADO/GitHub clients; saving is the shell's
// `host.adapters.artifacts` (desktop main process), handed the item and only that provider's token.
// Where the shell can't save files this is null and the drawer shows no Artifacts section.
import { listArtifacts } from '@nexusmd/core'
import { getAdoConfig, createAdoHttpAdapter } from './ado-client.js'
import { getGithubConfig, createGithubHttpAdapter } from './github-client.js'

export function makeBuildArtifacts(adapter, { ado = createAdoHttpAdapter, github = createGithubHttpAdapter } = {}) {
  if (!adapter?.saveArtifact || (adapter.available && !adapter.available())) return null
  return {
    list: build => listArtifacts(build, { ado: ado(), github: github(), org: getAdoConfig().org }),
    save: item => {
      if (item.provider === 'github') return adapter.saveArtifact(item, { pat: getGithubConfig().pat })
      const { org, pat } = getAdoConfig()
      return adapter.saveArtifact(item, { org, pat })
    },
  }
}
