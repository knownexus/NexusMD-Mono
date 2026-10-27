// desktop-build-source.js — direct-to-ADO build timeline source for the desktop
// app (no ASP.NET proxy available). Mirrors the shape expected by the shared
// BuildDetail component (packages/ui/src/views/build-detail.jsx):
//   loadTimeline(project, id) → { failedRecords: [{ name, type, messages }] }
import { mapBuildTimeline } from '@nexusmd/core'
import { createAdoHttpAdapter } from './ado-client.js'

export const desktopBuildSource = {
  async loadTimeline(project, id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`${encodeURIComponent(project)}/_apis/build/builds/${id}/timeline?api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = await res.json()
    return mapBuildTimeline(raw)
  },
}
