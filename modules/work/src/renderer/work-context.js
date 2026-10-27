import React from 'react'

// What Work's screens share: the drawers they open, the unseen-item markers, the refresh and the
// editable copy of the work items. Provided by WorkProvider, which wraps the whole shell.
export const WorkContext = React.createContext(null)

export function useWork() {
  const ctx = React.useContext(WorkContext)
  if (!ctx) throw new Error('useWork must be used inside the Work app\'s provider.')
  return ctx
}

// Like useWork, but null when there is no provider.
export function useOptionalWork() {
  return React.useContext(WorkContext)
}
