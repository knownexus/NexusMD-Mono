// packages/core/src/modules/workitems/classify.js — one shared bucketing of a work
// item into done / blocked / review / active, used by the dashboard, team cards and
// digest. ADO items keep the name-based rules in ado/helpers.js; Jira items also
// fall back to their status category, since Jira status names are site-defined.
import { isTerminalState, isActiveState, isReviewState, isBlockedState } from '../ado/helpers.js'

const isJira = (w) => w?.source === 'jira'

export const isDoneItem = (w) => isTerminalState(w?.state, w?.stateCategory)

export const isBlockedItem = (w) => !isDoneItem(w)
  && (isBlockedState(w.state) || /block/i.test(w.state || '') || !!w.flagged)

export const isReviewItem = (w) => !isDoneItem(w) && !isBlockedItem(w)
  && (isReviewState(w.state) || (isJira(w) && /review|qa|uat|test/i.test(w.state || '')))

export const isActiveItem = (w) => !isDoneItem(w) && !isBlockedItem(w) && !isReviewItem(w)
  && (isActiveState(w.state) || (isJira(w) && w.stateCategory === 'InProgress'))
