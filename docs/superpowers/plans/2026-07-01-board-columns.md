# Board Columns Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `BOARD_LANES` constant in the workitem board with a per-project column config that auto-syncs from real ADO states, persists across sessions, and is manageable via the Settings panel.

**Architecture:** Pure sync/query functions live in `packages/core` (testable with vitest). A `usePersisted` hook in `view-workitems.jsx` stores the config; a `useEffect` watching `wiTypeStates` calls the pure sync function to append new states. `BoardColumnsCard` in `view-settings.jsx` provides the management UI and is wired into the desktop settings panel.

**Tech Stack:** React (no new dependencies), vitest, HTML5 drag for reorder, `usePersisted` hook (already exists).

## Global Constraints

- No new npm dependencies
- All new exported functions must be pure (no side effects, no React)
- Config is persisted under key `nexusmd.wi.boardColumns` via `usePersisted`
- Per-project key = project slug; single-project fallback key = `__global__`
- `columns` = ordered list of all known states; `hidden` = subset not shown on board; `autoAdded` = subset added by sync (not manually)
- Auto-sync only appends — never removes columns
- `BOARD_LANES` constant and `boardLanesFor()` function are deleted as part of Task 2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/modules/ado/board-columns.js` | **Create** | Pure functions: sync, query lanes, reorder, hide, add, reset |
| `packages/core/tests/ado/board-columns.test.js` | **Create** | Vitest unit tests for all pure functions |
| `packages/core/src/modules/ado/index.js` | **Modify** | Export new functions |
| `packages/ui/src/views/view-workitems.jsx` | **Modify** | Replace `BOARD_LANES`/`boardLanesFor()` with persisted config + sync effect |
| `packages/ui/src/views/view-settings.jsx` | **Modify** | Add `BoardColumnsCard` component; export it |
| `apps/desktop/src/main.jsx` | **Modify** | Add `<BoardColumnsCard>` to the settings panel |

---

### Task 1: Pure board-columns logic module

**Files:**
- Create: `packages/core/src/modules/ado/board-columns.js`
- Create: `packages/core/tests/ado/board-columns.test.js`
- Modify: `packages/core/src/modules/ado/index.js`

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `syncBoardColumns(config, projectKey, detectedStates) → config`
  - `getActiveLanes(config, activeProjectId, projects, fallback) → string[]`
  - `removeAutoAdded(config, projectKey, state) → config`
  - `resetToDetected(config, projectKey, detectedStates) → config`
  - `reorderColumns(config, projectKey, newOrder) → config`
  - `toggleColumnHidden(config, projectKey, state, hide) → config`
  - `addManualColumn(config, projectKey, state) → config`
  - Config shape: `{ [projectKey: string]: { columns: string[], autoAdded: string[], hidden: string[] } }`

- [ ] **Step 1: Write the failing tests**

```js
// packages/core/tests/ado/board-columns.test.js
import { describe, it, expect } from 'vitest'
import {
  syncBoardColumns, getActiveLanes, removeAutoAdded,
  resetToDetected, reorderColumns, toggleColumnHidden, addManualColumn,
} from '../../src/modules/ado/board-columns.js'

const FALLBACK = ['To Do', 'In Progress', 'Done']

describe('syncBoardColumns', () => {
  it('initialises from empty config', () => {
    const result = syncBoardColumns({}, 'proj-a', ['To Do', 'Active', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].autoAdded).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].hidden).toEqual([])
  })

  it('appends new states not already in columns', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Done'], autoAdded: ['To Do', 'Done'], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done', 'Testing'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Done', 'Testing'])
    expect(result['proj-a'].autoAdded).toContain('Testing')
  })

  it('does not duplicate states already present', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Done'], autoAdded: [], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Done'])
  })

  it('returns same reference when nothing changes', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do'])
    expect(result).toBe(config)
  })

  it('preserves manually-added columns not in detected set', () => {
    const config = { 'proj-a': { columns: ['To Do', 'My Custom'], autoAdded: ['To Do'], hidden: [] } }
    const result = syncBoardColumns(config, 'proj-a', ['To Do', 'Done'])
    expect(result['proj-a'].columns).toContain('My Custom')
    expect(result['proj-a'].columns).toContain('Done')
  })
})

describe('getActiveLanes', () => {
  const config = {
    '__global__': { columns: ['To Do', 'Active', 'Done'], autoAdded: [], hidden: [] },
    'proj-a':     { columns: ['To Do', 'Testing', 'Done'], autoAdded: [], hidden: ['Done'] },
    'proj-b':     { columns: ['Backlog', 'In Progress', 'Done'], autoAdded: [], hidden: [] },
  }

  it('returns fallback when config is empty', () => {
    expect(getActiveLanes({}, 'all', [{ id: 'proj-a' }], FALLBACK)).toEqual(FALLBACK)
  })

  it('uses __global__ for single project', () => {
    const lanes = getActiveLanes(config, 'all', [{ id: 'proj-a' }], FALLBACK)
    expect(lanes).toEqual(['To Do', 'Active', 'Done'])
  })

  it('uses per-project config for specific project', () => {
    const lanes = getActiveLanes(config, 'proj-a', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes).toEqual(['To Do', 'Testing'])   // 'Done' is hidden
  })

  it('unions all projects for "all" view, first project order first', () => {
    const lanes = getActiveLanes(config, 'all', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes[0]).toBe('To Do')   // proj-a first
    expect(lanes).toContain('Backlog')
    expect(lanes).toContain('In Progress')
    expect(lanes).not.toContain('Done') // hidden in proj-a; proj-b has it visible — union keeps it
  })

  it('respects hidden columns', () => {
    const lanes = getActiveLanes(config, 'proj-a', [{ id: 'proj-a' }, { id: 'proj-b' }], FALLBACK)
    expect(lanes).not.toContain('Done')
  })
})

describe('removeAutoAdded', () => {
  it('removes state from autoAdded and adds to hidden', () => {
    const config = { 'proj-a': { columns: ['To Do', 'Testing'], autoAdded: ['Testing'], hidden: [] } }
    const result = removeAutoAdded(config, 'proj-a', 'Testing')
    expect(result['proj-a'].autoAdded).not.toContain('Testing')
    expect(result['proj-a'].hidden).toContain('Testing')
    expect(result['proj-a'].columns).toContain('Testing')  // stays in columns, just hidden
  })

  it('does not duplicate in hidden', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: ['To Do'], hidden: ['To Do'] } }
    const result = removeAutoAdded(config, 'proj-a', 'To Do')
    expect(result['proj-a'].hidden.filter(s => s === 'To Do').length).toBe(1)
  })

  it('returns same config when projectKey not found', () => {
    const config = {}
    expect(removeAutoAdded(config, 'proj-x', 'Testing')).toBe(config)
  })
})

describe('resetToDetected', () => {
  it('replaces columns with detected states and marks all as autoAdded', () => {
    const config = { 'proj-a': { columns: ['Old', 'Manual'], autoAdded: ['Old'], hidden: ['Old'] } }
    const result = resetToDetected(config, 'proj-a', ['To Do', 'Active', 'Done'])
    expect(result['proj-a'].columns).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].autoAdded).toEqual(['To Do', 'Active', 'Done'])
    expect(result['proj-a'].hidden).toEqual([])
  })
})

describe('reorderColumns', () => {
  it('replaces column order', () => {
    const config = { 'proj-a': { columns: ['A', 'B', 'C'], autoAdded: [], hidden: [] } }
    const result = reorderColumns(config, 'proj-a', ['C', 'A', 'B'])
    expect(result['proj-a'].columns).toEqual(['C', 'A', 'B'])
  })
})

describe('toggleColumnHidden', () => {
  it('hides a visible column', () => {
    const config = { 'proj-a': { columns: ['A', 'B'], autoAdded: [], hidden: [] } }
    const result = toggleColumnHidden(config, 'proj-a', 'A', true)
    expect(result['proj-a'].hidden).toContain('A')
  })

  it('unhides a hidden column', () => {
    const config = { 'proj-a': { columns: ['A', 'B'], autoAdded: [], hidden: ['A'] } }
    const result = toggleColumnHidden(config, 'proj-a', 'A', false)
    expect(result['proj-a'].hidden).not.toContain('A')
  })
})

describe('addManualColumn', () => {
  it('appends new state without marking it autoAdded', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = addManualColumn(config, 'proj-a', 'Staging')
    expect(result['proj-a'].columns).toContain('Staging')
    expect(result['proj-a'].autoAdded).not.toContain('Staging')
  })

  it('does not duplicate if state already present', () => {
    const config = { 'proj-a': { columns: ['To Do'], autoAdded: [], hidden: [] } }
    const result = addManualColumn(config, 'proj-a', 'To Do')
    expect(result['proj-a'].columns.filter(s => s === 'To Do').length).toBe(1)
  })

  it('initialises project entry if not present', () => {
    const result = addManualColumn({}, 'proj-a', 'Staging')
    expect(result['proj-a'].columns).toEqual(['Staging'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && npm test -- board-columns
```

Expected: all tests FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/modules/ado/board-columns.js

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

  // Union: first project's order, then unique columns from remaining projects
  const seen = new Set()
  const result = []
  const firstId = projects[0]?.id
  visibleColumns(config[firstId]).forEach(c => { seen.add(c); result.push(c) })
  projects.slice(1).forEach(p => {
    visibleColumns(config[p.id]).forEach(c => { if (!seen.has(c)) { seen.add(c); result.push(c) } })
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/core && npm test -- board-columns
```

Expected: all tests PASS

- [ ] **Step 5: Export from ado/index.js**

Add to `packages/core/src/modules/ado/index.js`:

```js
export {
  syncBoardColumns, getActiveLanes, removeAutoAdded, resetToDetected,
  reorderColumns, toggleColumnHidden, addManualColumn,
} from './board-columns.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/ado/board-columns.js \
        packages/core/tests/ado/board-columns.test.js \
        packages/core/src/modules/ado/index.js
git commit -m "feat(core): add board-columns pure logic module"
```

---

### Task 2: Wire persisted column config into WorkItemsView

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx`

**Interfaces:**
- Consumes from Task 1: `syncBoardColumns`, `getActiveLanes` (exact signatures above)
- `wiTypeStates`: `{ [workItemTypeName: string]: string[] }` — already in component state at line 356
- `PROJECTS`: project array from `useNexusData()`, each with `{ id: string, name: string }`
- `activeProject`: string slug or `'all'` — already in component state at line 235

- [ ] **Step 1: Add import at the top of view-workitems.jsx**

After the existing imports (around line 10), add:

```js
import { syncBoardColumns, getActiveLanes } from '@nexusmd/core';
```

- [ ] **Step 2: Add usePersisted for board column config**

After the existing `usePersisted` calls (around line 252), add:

```js
const [boardColumnConfig, setBoardColumnConfig] = usePersisted('nexusmd.wi.boardColumns', {});
```

- [ ] **Step 3: Add sync useEffect**

After the `wiTypeStates` fetch effect (around line 363), add:

```js
React.useEffect(() => {
  if (Object.keys(wiTypeStates).length === 0) return;
  // Union all states from all work item types
  const detectedStates = [...new Set(Object.values(wiTypeStates).flat())];
  if (detectedStates.length === 0) return;

  setBoardColumnConfig(prev => {
    const useGlobal = PROJECTS.length <= 1;
    if (useGlobal) {
      return syncBoardColumns(prev, '__global__', detectedStates);
    }
    let next = prev;
    PROJECTS.forEach(p => {
      // Per-project: states from items in that project + global detected states
      const projectItemStates = [...new Set(allItems.filter(w => w.project === p.id).map(w => w.state).filter(Boolean))];
      const combined = [...new Set([...projectItemStates, ...detectedStates])];
      next = syncBoardColumns(next, p.id, combined);
    });
    return next;
  });
}, [wiTypeStates, PROJECTS, allItems]);
```

- [ ] **Step 4: Replace boardLanesFor() call with getActiveLanes()**

Find the existing line (around line 758–760) that reads:

```js
lanes={boardLanesFor(activeStates, STATES)}
```

Replace with:

```js
lanes={getActiveLanes(boardColumnConfig, activeProject, PROJECTS, BOARD_LANES)}
```

- [ ] **Step 5: Delete BOARD_LANES constant and boardLanesFor function**

Delete lines 1255–1266 (the `BOARD_LANES` constant and `boardLanesFor` function). After deletion, add a minimal fallback constant at module scope used only as the `fallback` argument above:

```js
const BOARD_LANES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done'];
```

(Keep it as a fallback only — it is never used as the primary source of truth once config exists.)

- [ ] **Step 6: Verify board renders correctly**

Start the desktop app and open the Work Items board view. Confirm:
- Board columns now reflect real ADO states (check that states from your org appear as lanes)
- Columns from `BOARD_LANES` appear on first load before sync runs
- After data loads, the lanes update to the detected set

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx
git commit -m "feat(ui): drive board columns from persisted ADO-synced config"
```

---

### Task 3: BoardColumnsCard settings UI

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx`

**Interfaces:**
- Consumes from Task 1: `reorderColumns`, `toggleColumnHidden`, `addManualColumn`, `removeAutoAdded`, `resetToDetected`, `getActiveLanes`
- Receives as props:
  - `boardColumnConfig: object` — the full config from `usePersisted`
  - `setBoardColumnConfig: (fn | value) => void` — setter from `usePersisted`
  - `projects: Array<{ id: string, name: string }>` — from `useNexusData()`
  - `wiTypeStates: { [type: string]: string[] }` — from the parent; used for "Reset to detected"
- Exported as `BoardColumnsCard`

- [ ] **Step 1: Add import of pure functions**

At the top of `view-settings.jsx`, add:

```js
import { reorderColumns, toggleColumnHidden, addManualColumn, removeAutoAdded, resetToDetected } from '@nexusmd/core';
```

- [ ] **Step 2: Implement BoardColumnsCard**

Add the following component before the `export {` block at the bottom of `view-settings.jsx`:

```jsx
export function BoardColumnsCard({ boardColumnConfig, setBoardColumnConfig, projects = [], wiTypeStates = {} }) {
  const useGlobal = projects.length <= 1;
  const [selectedProject, setSelectedProject] = useStateVS(() => useGlobal ? '__global__' : (projects[0]?.id || '__global__'));
  const [newColName, setNewColName] = useStateVS('');
  const [dragIdx, setDragIdx] = useStateVS(null);
  const [overIdx, setOverIdx] = useStateVS(null);

  const projectKey = useGlobal ? '__global__' : selectedProject;
  const entry = boardColumnConfig[projectKey] || { columns: [], autoAdded: [], hidden: [] };

  const update = (fn) => setBoardColumnConfig(prev => fn(prev));

  const onDragStart = (idx) => setDragIdx(idx);
  const onDragOver = (e, idx) => { e.preventDefault(); setOverIdx(idx); };
  const onDrop = (e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return; }
    const newOrder = [...entry.columns];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    update(c => reorderColumns(c, projectKey, newOrder));
    setDragIdx(null); setOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  const detectedStates = [...new Set(Object.values(wiTypeStates).flat())];

  return (
    <VsCard title="Board columns" icon="board">
      {!useGlobal && projects.length > 1 && (
        <VsRow title="Project" desc="Configure columns per project">
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}
          >
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </VsRow>
      )}

      <VsFullRow
        title="Columns"
        desc="Drag to reorder · toggle to show/hide · ✕ to undo auto-detected columns"
      >
        {entry.columns.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>
            No columns configured yet — columns appear automatically after the board loads ADO states.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {entry.columns.map((col, idx) => {
            const isHidden   = (entry.hidden || []).includes(col);
            const isAutoAdded = (entry.autoAdded || []).includes(col);
            const isDragging  = dragIdx === idx;
            const isOver      = overIdx === idx && dragIdx !== null && dragIdx !== idx;
            return (
              <div
                key={col}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={e => onDragOver(e, idx)}
                onDrop={e => onDrop(e, idx)}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 8, border: `1px solid ${isOver ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: isOver ? 'var(--accent-soft)' : isDragging ? 'var(--surface-2)' : 'var(--surface)',
                  opacity: isDragging ? 0.5 : 1,
                  transition: 'border-color .1s, background .1s',
                  cursor: 'grab',
                  userSelect: 'none',
                }}
              >
                {/* Drag handle */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-subtle)', flexShrink: 0 }}>
                  {[0,1].map(i => (
                    <span key={i} style={{ display: 'flex', gap: 2 }}>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                    </span>
                  ))}
                </span>

                {/* Show/hide checkbox */}
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onChange={e => update(c => toggleColumnHidden(c, projectKey, col, !e.target.checked))}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
                  onClick={e => e.stopPropagation()}
                />

                {/* Column name */}
                <span style={{ flex: 1, fontSize: 13, color: isHidden ? 'var(--text-subtle)' : 'var(--text)', textDecoration: isHidden ? 'line-through' : 'none' }}>
                  {col}
                </span>

                {/* Auto badge + undo */}
                {isAutoAdded && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 4, padding: '1px 6px',
                  }}>
                    Auto
                    <button
                      onClick={e => { e.stopPropagation(); update(c => removeAutoAdded(c, projectKey, col)); }}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', lineHeight: 1 }}
                      title="Undo auto-added (hides this column)"
                    >✕</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Add column input */}
        <form
          onSubmit={e => {
            e.preventDefault();
            const name = newColName.trim();
            if (!name) return;
            update(c => addManualColumn(c, projectKey, name));
            setNewColName('');
          }}
          style={{ display: 'flex', gap: 6, marginTop: 4, width: '100%' }}
        >
          <input
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            placeholder="Add column…"
            style={{ flex: 1, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--text)', fontFamily: 'var(--sans)' }}
          />
          <button type="submit" className="btn sm" disabled={!newColName.trim()}>Add</button>
        </form>

        {/* Reset link */}
        {detectedStates.length > 0 && (
          <button
            type="button"
            onClick={() => update(c => resetToDetected(c, projectKey, detectedStates))}
            style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', alignSelf: 'flex-start', marginTop: 2 }}
          >
            Reset to detected ADO states
          </button>
        )}
      </VsFullRow>
    </VsCard>
  );
}
```

- [ ] **Step 3: Add BoardColumnsCard to the export block**

Find the export block near the bottom of `view-settings.jsx`:

```js
export {
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  ...
```

Add `BoardColumnsCard` to that list.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx
git commit -m "feat(ui): add BoardColumnsCard settings component"
```

---

### Task 4: Wire BoardColumnsCard into desktop settings panel

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes from Task 3: `BoardColumnsCard` (imported from `@nexusmd/ui`)
- Props required: `boardColumnConfig`, `setBoardColumnConfig`, `projects`, `wiTypeStates`
- These must be threaded from the component that owns `usePersisted('nexusmd.wi.boardColumns', {})` — currently `WorkItemsView`, but the settings panel is a sibling. Lift state or read directly via a shared hook in the settings component.

**Threading approach:** Since `BoardColumnsCard` needs `boardColumnConfig`/`setBoardColumnConfig` and `wiTypeStates` from the same data the board uses, the cleanest path is to have `BoardColumnsCard` call `usePersisted` and `useNexusData()` itself, removing those as props. This avoids prop-threading across unrelated components.

- [ ] **Step 1: Update BoardColumnsCard to own its own state**

In `view-settings.jsx`, modify the `BoardColumnsCard` signature and body to call `usePersisted` and `useNexusData()` directly:

```jsx
export function BoardColumnsCard() {
  const { data: NexusMDData } = useNexusData();             // already imported in file
  const [boardColumnConfig, setBoardColumnConfig] = usePersisted('nexusmd.wi.boardColumns', {});
  // Read wiTypeStates from a localStorage snapshot written by view-workitems.jsx
  // (see Step 2 — we write wiTypeStates to storage so settings can read it without prop threading)
  const wiTypeStates = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('nexusmd.wi.wiTypeStates.cache');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);
  const projects = NexusMDData.PROJECTS || [];
  // ... rest of the component unchanged, but remove the props destructuring
```

Note: `usePersisted` is already available in `view-settings.jsx` (the file imports from the same package). Check if `usePersisted` is available — if not, import it from `../app-components.jsx`.

- [ ] **Step 2: Write wiTypeStates snapshot from WorkItemsView**

In `packages/ui/src/views/view-workitems.jsx`, after the `wiTypeStates` fetch effect (around line 363), add a side-effect to cache it:

```js
React.useEffect(() => {
  if (Object.keys(wiTypeStates).length === 0) return;
  try {
    localStorage.setItem('nexusmd.wi.wiTypeStates.cache', JSON.stringify(wiTypeStates));
  } catch {}
}, [wiTypeStates]);
```

- [ ] **Step 3: Import BoardColumnsCard in main.jsx**

In `apps/desktop/src/main.jsx`, find the existing import line that includes `VsCard` (around line 14):

```js
import {
  IntegrationsView, VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  ...
} from '@nexusmd/ui';
```

Add `BoardColumnsCard` to that import.

- [ ] **Step 4: Add BoardColumnsCard to the settings panel**

In `apps/desktop/src/main.jsx`, find the settings panel render (around line 966, after the `"Project areas"` VsCard):

```jsx
      <VsCard title="Project areas" icon="work">
        ...
      </VsCard>
    </div>
```

Insert before the closing `</div>`:

```jsx
      <BoardColumnsCard />
```

- [ ] **Step 5: Verify in the app**

Start the desktop app. Navigate to Settings. Confirm:
- "Board columns" card appears in the settings panel
- Columns are listed with drag handles, checkboxes, and "Auto" badges
- Drag reorder works: drag a column up/down and confirm the board reflects the new order
- Unchecking a column hides it from the board
- Clicking ✕ on an "Auto" badge hides that column and removes the badge
- Typing a name in the "Add column" input and pressing Enter adds it to the list (without Auto badge)
- "Reset to detected ADO states" restores the auto-detected set
- With multiple projects configured: the project selector appears and switching projects shows per-project columns
- Board view reflects all changes live

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main.jsx packages/ui/src/views/view-settings.jsx packages/ui/src/views/view-workitems.jsx
git commit -m "feat(desktop): wire BoardColumnsCard into settings panel"
```

---

## Self-Review

**Spec coverage:**
- ✅ Board columns derived from real ADO states (`wiTypeStates`) — Task 2 sync effect
- ✅ Per-project config with `__global__` fallback — `syncBoardColumns` + `getActiveLanes`
- ✅ Auto-sync appends only, never removes — `syncBoardColumns` returns early if nothing new
- ✅ Auto-added badge + undo — `removeAutoAdded` + badge render in Task 3
- ✅ Draggable reorder — HTML5 drag in `BoardColumnsCard`
- ✅ Show/hide checkbox — `toggleColumnHidden`
- ✅ Manual add column — `addManualColumn`
- ✅ Reset to detected — `resetToDetected`
- ✅ Settings panel (Settings/Integrations panel, desktop) — Task 4
- ✅ Empty-config fallback to `BOARD_LANES` — `getActiveLanes` fallback param
- ✅ All-projects union view — `getActiveLanes` union branch

**Type consistency:** All function names used in Tasks 2, 3, 4 match Task 1 definitions exactly.

**Placeholder scan:** No TBDs. All code blocks are complete.
