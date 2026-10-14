// Unsaved profile edits, kept outside React so they outlive the Profile tab: switching tabs,
// files or leaving Dev Environment keeps them; reloading the window doesn't (by design).
// Keyed by profile folder + path, so a draft can never be saved into another folder.
import React from 'react'

const drafts = new Map()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const keyOf = (dir, path) => `${dir}\u0000${path}`

export function getDraft(dir, path) {
  return drafts.get(keyOf(dir, path)) || null
}

// draft = { text, baseStamp } - baseStamp is the file's stamp when the edit began (null: new file).
export function setDraft(dir, path, draft) {
  drafts.set(keyOf(dir, path), draft)
  emit()
}

export function clearDraft(dir, path) {
  if (drafts.delete(keyOf(dir, path))) emit()
}

export function hasDraft(dir, path) {
  return drafts.has(keyOf(dir, path))
}

export function hasDrafts() {
  return drafts.size > 0
}

export function clearAllDrafts() {
  drafts.clear()
  emit()
}

// Re-renders the caller whenever any draft changes.
export function useDraftsVersion() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const l = () => setVersion(v => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return version
}
