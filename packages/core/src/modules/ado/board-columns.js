/**
 * Config shape:
 * { [projectKey: string]: { columns: string[], autoAdded: string[], hidden: string[] } }
 *
 * projectKey: project slug, or '__global__' when only one project is configured.
 * columns: ordered list of all known state names (visible + hidden).
 * autoAdded: subset of columns added by auto-sync (not by the user).
 * hidden: subset of columns not rendered on the board.
 */

export function syncBoardColumns(config, projectKey, detectedStates) {
  const existing = config[projectKey]
  if (!existing) {
    return {
      ...config,
      [projectKey]: { columns: [...detectedStates], autoAdded: [...detectedStates], hidden: [] },
    }
  }
  const newStates = detectedStates.filter(s => !existing.columns.includes(s))
  if (newStates.length === 0) return config
  return {
    ...config,
    [projectKey]: {
      columns: [...existing.columns, ...newStates],
      autoAdded: [...existing.autoAdded, ...newStates],
      hidden: existing.hidden || [],
    },
  }
}

function visibleColumns(entry) {
  if (!entry) return []
  return entry.columns.filter(c => !(entry.hidden || []).includes(c))
}

export function getActiveLanes(config, activeProjectId, projects, fallback) {
  if (Object.keys(config).length === 0) return fallback

  if (projects.length <= 1) {
    const lanes = visibleColumns(config['__global__'])
    return lanes.length ? lanes : fallback
  }

  if (activeProjectId && activeProjectId !== 'all') {
    const lanes = visibleColumns(config[activeProjectId])
    return lanes.length ? lanes : fallback
  }

  // Union: exclude columns hidden in any project
  const hiddenInAny = new Set()
  projects.forEach(p => {
    const entry = config[p.id]
    if (entry && entry.hidden) {
      entry.hidden.forEach(c => hiddenInAny.add(c))
    }
  })

  // Build result: first project's visible columns, then new columns from others (not hidden in any)
  const seen = new Set()
  const result = []
  const firstId = projects[0]?.id
  visibleColumns(config[firstId]).forEach(c => { seen.add(c); result.push(c) })
  projects.slice(1).forEach(p => {
    visibleColumns(config[p.id]).forEach(c => {
      if (!seen.has(c) && !hiddenInAny.has(c)) {
        seen.add(c)
        result.push(c)
      }
    })
  })
  return result.length ? result : fallback
}

export function removeAutoAdded(config, projectKey, state) {
  const existing = config[projectKey]
  if (!existing) return config
  const hidden = existing.hidden || []
  return {
    ...config,
    [projectKey]: {
      ...existing,
      autoAdded: existing.autoAdded.filter(s => s !== state),
      hidden: hidden.includes(state) ? hidden : [...hidden, state],
    },
  }
}

export function resetToDetected(config, projectKey, detectedStates) {
  return {
    ...config,
    [projectKey]: { columns: [...detectedStates], autoAdded: [...detectedStates], hidden: [] },
  }
}

export function reorderColumns(config, projectKey, newOrder) {
  const existing = config[projectKey]
  if (!existing) return config
  return { ...config, [projectKey]: { ...existing, columns: newOrder } }
}

export function toggleColumnHidden(config, projectKey, state, hide) {
  const existing = config[projectKey]
  if (!existing) return config
  const hidden = existing.hidden || []
  const newHidden = hide
    ? hidden.includes(state) ? hidden : [...hidden, state]
    : hidden.filter(s => s !== state)
  return { ...config, [projectKey]: { ...existing, hidden: newHidden } }
}

export function addManualColumn(config, projectKey, state) {
  const existing = config[projectKey] || { columns: [], autoAdded: [], hidden: [] }
  if (existing.columns.includes(state)) return config
  return {
    ...config,
    [projectKey]: { ...existing, columns: [...existing.columns, state] },
  }
}
