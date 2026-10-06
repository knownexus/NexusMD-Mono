// State categories shared by ADO and Jira, used for the merged board's columns.
import { adoTypeToHelm, stateCategory as bucketOf } from '../ado/helpers.js'

export const CATEGORY_LANES = ['Proposed', 'InProgress', 'Resolved', 'Completed']
export const CATEGORY_LABELS = {
  Proposed: 'Proposed', InProgress: 'In Progress', Resolved: 'Resolved', Completed: 'Completed',
}

export function itemCategory(item) {
  const c = item?.stateCategory
  if (c === 'Removed') return 'Completed'
  if (CATEGORY_LANES.includes(c)) return c
  const bucket = bucketOf(item?.state)
  if (bucket === 'done') return 'Completed'
  if (bucket === 'todo') return 'Proposed'
  return 'InProgress'
}

// First state (in the type's workflow order) whose ADO category matches.
export function adoStateForCategory(item, category, { typeStates = {}, stateCategoryByName = {} } = {}) {
  const typeName = Object.keys(typeStates).find(t => adoTypeToHelm(t) === item?.type)
  const candidates = typeName ? typeStates[typeName] : Object.keys(stateCategoryByName)
  return candidates.find(s => stateCategoryByName[s] === category) || null
}
