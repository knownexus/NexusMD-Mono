// ado-workitem-types.js — binds the @nexusmd/core work item type helpers to the desktop's
// ADO connection and profile-scoped cache. The logic itself lives in core.
import * as core from '@nexusmd/core'
import { getProfileKey } from './profile-keys.js'
import { createAdoHttpAdapter } from './ado-client.js'

export {
  fieldBucket, fieldGroup, TYPE_LAYOUTS, resolveTypeLayout, LINK_TYPES,
  buildFieldPatchOps, buildAttachmentRelationOps, buildLinkRelationOps,
} from '@nexusmd/core'

const store = core.makeWorkItemTypeDefsStore({
  storage: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
  key: (project, type) => getProfileKey(`ado.wiTypeDefs.${project}.${type}`),
})

export const { getCachedDefs, setCachedDefs } = store

export const fetchWorkItemTypes = (project) => core.fetchWorkItemTypes(createAdoHttpAdapter(), project)
export const fetchProjectFieldTypes = (project) => core.fetchProjectFieldTypes(createAdoHttpAdapter(), project)
export const fetchTypeFields = (project, type, fieldTypeMap) =>
  core.fetchTypeFields(createAdoHttpAdapter(), project, type, fieldTypeMap)
export const fetchClassificationPaths = (project) => core.fetchClassificationPaths(createAdoHttpAdapter(), project)
export const loadWorkItemTypeDefs = (project, type, opts) =>
  core.loadWorkItemTypeDefs(createAdoHttpAdapter(), store, project, type, opts)
export const submitNewWorkItem = (payload) => core.submitNewWorkItem(createAdoHttpAdapter(), payload)
