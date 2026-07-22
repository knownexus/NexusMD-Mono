// build-source.js — the data seam for BuildDetail. Mirrors work-item-source.js:
// the render code (BuildDetail) is shared; only how the timeline is fetched
// differs per platform.
//   loadTimeline(project, id) → { failedRecords: [{ name, type, messages }] }
//
// Default = a /api/builds/*/timeline web-host proxy. Desktop supplies an
// ado-client-backed source via NexusDataProvider (see apps/desktop/src/desktop-build-source.js).

export const apiBuildSource = {
  async loadTimeline(project, id) {
    try {
      const r = await fetch(`/api/builds/${id}/timeline?project=${encodeURIComponent(project || '')}`)
      if (!r.ok) return { failedRecords: [] }
      return await r.json()
    } catch {
      return { failedRecords: [] }
    }
  },
}
