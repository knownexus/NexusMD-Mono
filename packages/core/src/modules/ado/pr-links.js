// Reverse index: work-item id -> PRs that link to it. Pure; built from the
// already-loaded PRS array (each PR carries linkedWorkItems: [{ id }]).
export function indexPRsByWorkItem(prs) {
  const map = new Map()
  for (const pr of prs || []) {
    for (const w of pr.linkedWorkItems || []) {
      const id = Number(w.id)
      if (!Number.isFinite(id)) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(pr)
    }
  }
  return map
}
