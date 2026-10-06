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

import { isJiraId } from '@nexusmd/core'

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

// Dispatch each operation to the provider that owns the item: "jira:KEY" ids go
// to Jira, everything else (numeric ADO ids) to ADO. Methods are async so a
// routing error surfaces as a rejected promise, like any other save failure.
const ROUTED_METHODS = ['loadDetail', 'loadComments', 'addComment', 'saveField', 'loadRawFields']

export function createRoutedWorkItemSource({ ado, jira = null }) {
  const pick = (id) => {
    if (!isJiraId(id)) return ado
    if (!jira) throw new Error('Jira is not configured')
    return jira
  }
  const routed = { jira }
  for (const m of ROUTED_METHODS) routed[m] = async (id, ...rest) => pick(id)[m](id, ...rest)
  routed.createWorkItem = async (payload) => ado.createWorkItem(payload)
  routed.moveToCategory = async (id, category, item) => {
    const s = pick(id)
    if (!s.moveToCategory) throw new Error('Moving between categories is not supported for this item')
    return s.moveToCategory(id, category, item)
  }
  routed.availableTargetStates = async (id) => {
    const s = pick(id)
    return s.availableTargetStates ? s.availableTargetStates(id) : null
  }
  routed.webUrl = (item) => {
    if (!item) return null
    try {
      const s = pick(item.id)
      return s.webUrl ? s.webUrl(item) : null
    } catch { return null }
  }
  return routed
}
