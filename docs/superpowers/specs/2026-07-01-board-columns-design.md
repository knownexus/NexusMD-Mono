# Board Columns: Auto-sync from ADO Repos

**Date:** 2026-07-01  
**Status:** Approved

## Problem

The workitem board (`packages/ui/src/views/view-workitems.jsx`) uses a hardcoded `BOARD_LANES` constant:

```js
const BOARD_LANES = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Blocked', 'Done'];
```

This diverges from actual ADO repo states in two ways:
1. Different ADO projects within an org may use different state sets (e.g. one has "Testing", another does not)
2. The hardcoded list may not match what the ADO work item type API actually returns

Cards with states not in `BOARD_LANES` only appear on the board via the `adoStateToHelm()` normalization — custom or non-standard states go invisible.

## Goal

- Board columns automatically reflect real ADO states per project
- New states discovered on refresh are silently added to the end of the column list (never removed automatically)
- User can reorder, hide, and manually add columns per project via the Settings panel
- One global config when only one project is configured; per-project otherwise

## Architecture

Three separated concerns:

1. **State detection** — derive canonical column set per project from `wiTypeStates` (already fetched and in memory via `/api/workitems/states`)
2. **Persistence** — `usePersisted('nexusmd.wi.boardColumns', {})` stores the column config in localStorage
3. **Sync logic** — on every ADO refresh, compare detected states to persisted config; silently append missing states; track auto-added entries

The board's existing `lanes` prop remains the interface — it is now driven by persisted config instead of `BOARD_LANES`.

## Data Shape

Persisted under key `nexusmd.wi.boardColumns`:

```js
{
  "project-slug": {
    columns: ["To Do", "Active", "In Review", "Done"],
    autoAdded: ["Active"]          // subset of columns — auto-detected, not manually placed
  },
  "__global__": {
    columns: [...],
    autoAdded: [...]
  }
}
```

- `__global__` is used when `PROJECTS.length === 1`; per-project keys are used otherwise
- `autoAdded` tracks which entries were added by sync (not by the user), enabling undo

## Sync Logic

Triggered by a `useEffect` in `WorkItemsView` watching `wiTypeStates` and `PROJECTS`:

1. For each project, compute the union of all states from `wiTypeStates` values
2. Load current persisted config for that project key
3. Any state not already in `columns` → append to end + add to `autoAdded`
4. First-time (no persisted entry): write detected union as initial config (all entries marked `autoAdded`)
5. Write back only if the config changed

## Board Rendering

Replace the `boardLanesFor(activeStates, STATES)` call in `WorkItemsView` with a derived `activeLanes` value:

- When project filter is "all": union of all project configs' visible columns, deduped — order follows the first project's column list, with columns unique to other projects appended in discovery order
- When a single project filter is active: use that project's config
- If no config exists yet (first load before sync runs): fall back to `BOARD_LANES`

`WIBoard`, `BoardLanes`, and `DragContextBar` are unchanged — they already accept `lanes` as a prop.

## Settings UI

New **"Board Columns"** section inside the existing Settings/Integrations panel.

**Layout:**
- Project selector (tab or `<select>`) — hidden when only 1 project
- Draggable ordered list of column entries:
  - Drag handle (same dot-grid pattern used in board cards)
  - Checkbox: show/hide the column on the board
  - Column name label
  - "Auto" badge (styled like existing filter chips) for auto-detected entries
  - ✕ button on auto-added entries to undo (removes from `autoAdded`; hides the column)
- "+ Add column" text input at the bottom (enter to commit; appends to columns without auto badge)
- "Reset to detected" link: clears manual overrides, re-runs sync from current `wiTypeStates`

**Drag reorder:** HTML5 drag (same pattern as board cards/table rows); updates `columns` array order on drop.

## Error Handling & Edge Cases

| Scenario | Behaviour |
|---|---|
| `wiTypeStates` not yet loaded | Fall back to `BOARD_LANES` until data arrives |
| All columns hidden | Board shows empty state with "Configure columns" link to Settings |
| Project removed from org config | Stale per-project entry remains in storage but is ignored |
| Card state not in any visible column | `adoStateToHelm()` normalization still applies — no regression |
| Cross-project "all" view | Union of all visible columns across projects, deduped |

## Files to Change

| File | Change |
|---|---|
| `packages/ui/src/views/view-workitems.jsx` | Add sync logic, replace `boardLanesFor()` with persisted config, pass derived lanes to `WIBoard` |
| Settings panel (web/desktop) | Add Board Columns section |

The `BOARD_LANES` constant and `boardLanesFor()` function are removed once the persisted config takes over.
