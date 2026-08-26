// Fetches an org's REAL work item types/states/priorities per project, so
// callers never have to guess at a process template's names. ADO's own
// per-state `category` field (Proposed/InProgress/Resolved/Completed/Removed)
// drives terminal/done classification instead of matching on English state
// names — a project can rename "Done" to "Verified" and this still works.

const TERMINAL_CATEGORIES = new Set(['Resolved', 'Completed', 'Removed'])
const DONE_CATEGORIES = new Set(['Resolved', 'Completed'])

export async function fetchAdoProcessMetadata(get, projects = []) {
  const typeNames = new Set()
  const typeStates = {}
  const stateCategoryByName = {}
  const priorityValues = new Set()

  await Promise.all(projects.map(async (proj) => {
    let types = []
    try {
      const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes?api-version=7.0`)
      types = (res.value || []).filter((t) => !t.isDisabled).map((t) => t.name)
    } catch (_) { return }

    await Promise.all(types.map(async (type) => {
      typeNames.add(type)

      try {
        const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?api-version=7.0`)
        const names = []
        ;(res.value || []).forEach((s) => {
          if (!s.name) return
          names.push(s.name)
          if (!stateCategoryByName[s.name]) stateCategoryByName[s.name] = s.category || 'Proposed'
        })
        if (names.length) {
          typeStates[type] = Array.from(new Set([...(typeStates[type] || []), ...names]))
        }
      } catch (_) {}

      try {
        const res = await get(`${encodeURIComponent(proj)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields?api-version=7.0`)
        const priorityField = (res.value || []).find((f) => f.referenceName === 'Microsoft.VSTS.Common.Priority')
        ;(priorityField?.allowedValues || []).forEach((v) => {
          const n = Number(v)
          if (Number.isFinite(n)) priorityValues.add(n)
        })
      } catch (_) {}
    }))
  }))

  const stateNames = Object.keys(stateCategoryByName)

  return {
    types: Array.from(typeNames).sort(),
    typeStates,
    stateCategoryByName,
    states: stateNames.sort(),
    terminalStateNames: stateNames.filter((n) => TERMINAL_CATEGORIES.has(stateCategoryByName[n])),
    doneStateNames: stateNames.filter((n) => DONE_CATEGORIES.has(stateCategoryByName[n])),
    priorities: Array.from(priorityValues).sort((a, b) => a - b),
  }
}
