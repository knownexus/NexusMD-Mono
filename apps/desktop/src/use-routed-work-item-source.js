// apps/desktop/src/use-routed-work-item-source.js — the routed (ADO + Jira) work item source,
// memoised so it keeps one identity across data refreshes.
import React from 'react'
import { createRoutedWorkItemSource } from '@nexusmd/ui'

// One routed source per (ado, jira) pair. Rebuilding it with every snapshot would
// give workItemSource a new identity on each data refresh, making WorkItemDetail
// reload and drop in-progress edits and comment drafts.
export function useRoutedWorkItemSource(ado, jira) {
  return React.useMemo(() => createRoutedWorkItemSource({ ado, jira }), [ado, jira])
}
