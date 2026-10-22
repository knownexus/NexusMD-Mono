// work-item-source.js — the Azure DevOps data source behind the shared WorkItemDetail:
// load/save fields, comments, create, move between status categories. Talks to ADO
// directly through an `http` adapter ({ fetch(path, options) } → Response-like), for
// hosts that have no backend proxy.
import { adoStateForCategory, CATEGORY_LABELS } from '../workitems/categories.js'

export async function adoMoveToCategory({ item, category, meta, saveState }) {
  const state = adoStateForCategory(item, category, meta || {}) || (category === 'Completed' ? 'Done' : null)
  if (!state) throw new Error(`No ${CATEGORY_LABELS[category] || category} state for ${item?.type || 'this type'} in ADO`)
  await saveState(state)
  return { state, stateCategory: category }
}

export function adoWorkItemUrl(org, item) {
  if (!org || !item?.project) return null
  const proj = String(item.project).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(proj)}/_workitems/edit/${item.id}`
}

/**
 * @param {object} opts
 * @param {{ fetch(path: string, options?: object): Promise<any> }} opts.http
 * @param {() => string} [opts.getDefaultProject] project used when a call doesn't name one
 * @param {() => string} [opts.getOrg] organisation, for webUrl
 * @param {() => object|undefined} [opts.loadProcessMeta] cached ADO process metadata, for moveToCategory
 * @param {(payload: object) => Promise<object>} [opts.createWorkItem] the host's create flow
 */
export function makeAdoWorkItemSource({
  http, getDefaultProject = () => '', getOrg = () => '', loadProcessMeta = () => undefined, createWorkItem,
}) {
  const source = {
    async loadDetail(id) {
      const res = await http.fetch(`_apis/wit/workitems/${id}?$expand=all&api-version=7.0`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const f = data.fields || {}
      return {
        description:        f['System.Description']                       || null,
        acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] || null,
        reproSteps:         f['Microsoft.VSTS.TCM.ReproSteps']            || null,
      }
    },
    async loadComments(id, project) {
      const proj = project || getDefaultProject()
      if (!proj) return []
      const res = await http.fetch(`${encodeURIComponent(proj)}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`)
      if (!res.ok) return []
      const data = await res.json()
      return (data.comments || []).map(c => ({
        id:          c.id,
        author:      c.createdBy?.displayName || '',
        text:        c.text || c.renderedText || '',
        createdDate: c.createdDate || '',
      }))
    },
    async saveField(itemId, field, html) {
      const res = await http.fetch(`_apis/wit/workitems/${itemId}?api-version=7.0`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify([{ op: 'add', path: `/fields/${field}`, value: html }]),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    async addComment(id, project, html) {
      const proj = encodeURIComponent(project || getDefaultProject())
      const res = await http.fetch(
        `${proj}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments: [{ parentCommentId: 0, content: html, commentType: 1 }], status: 1 }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return {
        id:          data.id,
        author:      data.createdBy?.displayName || '',
        text:        html,
        createdDate: data.createdDate || new Date().toISOString(),
      }
    },
    async loadRawFields(id) {
      const res = await http.fetch(`_apis/wit/workitems/${id}?$expand=fields&api-version=7.0`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data.fields || {}
    },
    async moveToCategory(id, category, item) {
      return adoMoveToCategory({
        item, category, meta: loadProcessMeta(),
        saveState: (state) => source.saveField(id, 'System.State', state),
      })
    },
    webUrl(item) {
      return adoWorkItemUrl(getOrg(), item)
    },
  }
  if (createWorkItem) source.createWorkItem = (payload) => createWorkItem(payload)
  return source
}
