// build-source.js — the data seam for BuildDetail. Mirrors work-item-source.js:
// the render code (BuildDetail) is shared; only how the timeline is fetched
// differs per platform.
//   loadTimeline(project, id) → { failedRecords: [{ name, type, messages }] }
//
// Web: proxies through AdoController at /api/ado/ (same PAT injection used for
// all other ADO calls). Desktop supplies a direct ADO-client-backed source via
// NexusDataProvider (see apps/desktop/src/desktop-build-source.js).

import { mapBuildTimeline } from '@nexusmd/core'

export const apiBuildSource = {
  async loadTimeline(project, id) {
    try {
      const r = await fetch(
        `/api/ado/${encodeURIComponent(project || '')}/_apis/build/builds/${id}/timeline?api-version=7.0`,
      )
      if (!r.ok) return { failedRecords: [] }
      const raw = await r.json()
      return mapBuildTimeline(raw)
    } catch {
      return { failedRecords: [] }
    }
  },
}
