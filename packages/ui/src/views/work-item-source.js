// work-item-source.js — the data seam for WorkItemDetail. The render code is shared;
// only the 5 data operations differ per platform. Each returns a normalised shape:
//   loadDetail   → { description, acceptanceCriteria, reproSteps }
//   loadComments → [{ id, author, text, createdDate }]
//   addComment   → { id, author, text, createdDate }
//   saveField    → void (throws on failure)
//   loadRawFields→ the raw ADO fields object
//
// Default = the ASP.NET host's /api/workitems/* proxy (web + desktop). The app
// supplies an ado-client-backed source via NexusDataProvider. A module-level mirror
// lets the non-component prefetch helper reach the active source.

export const apiWorkItemSource = {
  async loadDetail(id, _project) {
    const r = await fetch(`/api/workitems/${id}/detail`)
    return r.ok ? await r.json() : null
  },
  async loadComments(id, project) {
    const url = project
      ? `/api/workitems/${id}/comments?project=${encodeURIComponent(project)}`
      : `/api/workitems/${id}/comments`
    const r = await fetch(url)
    return r.ok ? ((await r.json())?.comments ?? []) : []
  },
  async saveField(itemId, field, html) {
    const r = await fetch(`/api/workitems/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ op: 'add', path: `/fields/${field}`, value: html }]),
    })
    if (!r.ok) {
      const msg = await r.text().catch(() => r.statusText)
      throw new Error(msg.slice(0, 120))
    }
  },
  async addComment(id, project, html) {
    const r = await fetch(`/api/workitems/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, text: html }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || r.statusText)
    return data // /api already returns { id, author, text, createdDate }
  },
  async loadRawFields(id) {
    const r = await fetch(`/api/workitems/${id}/fields`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  },
}

let _source = apiWorkItemSource

export function setWorkItemSource(s) { _source = s || apiWorkItemSource }
export function getWorkItemSource() { return _source }
