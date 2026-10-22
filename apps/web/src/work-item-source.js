// work-item-source.js — web's WorkItemDetail data source: the shared /api proxy source plus
// the workflow-aware status move, so "Mark done" and category lanes pick the project's real
// completed/resolved state instead of guessing "Done".
import { adoMoveToCategory } from '@nexusmd/core'
import { apiWorkItemSource } from '@nexusmd/ui'
import { NexusMDData } from './data.js'

export const webWorkItemSource = {
  ...apiWorkItemSource,
  moveToCategory: (id, category, item) => adoMoveToCategory({
    item, category, meta: NexusMDData._adoMeta,
    saveState: (state) => apiWorkItemSource.saveField(id, 'System.State', state),
  }),
}
