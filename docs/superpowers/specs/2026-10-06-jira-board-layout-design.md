# Jira Board Layout — Design

**Date:** 2026-10-06
**Status:** Approved design, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-10-06-jira-work-items-design.md` (Phase 1). This spec **supersedes Phase 1 amendment 6** ("No Agile API calls") and **amendment 8** ("Jira board columns … can't be customised"), for the board layout only.

## Goal

On the Work Items board's **Jira tab**, show the same columns as one of the user's Jira boards. Each column groups one or more Jira statuses, as on the real board, so NexusMD's board matches what the user sees in Jira.

## Decisions

| Topic | Decision |
|---|---|
| Source of the layout | Imported from a Jira board's configuration (Jira Agile REST API), not hand-built |
| Where it applies | The Jira tab only: separate display mode, or a profile where Jira is the only provider (the existing "Jira tab" lane logic). Merged mode keeps category columns; the ADO tab is unchanged |
| Which board | One board per profile, chosen in Settings from the boards of the selected projects |
| No board chosen | Current behaviour: one column per Jira status |
| Items shown | Unchanged: from the configured project keys and extra JQL. The board's own filter is **not** applied |
| Statuses not on the board | Trailing **Other** column, shown only when it contains cards |

## 1. Getting the layout

### 1.1 Core — `packages/core/src/modules/jira/boards.js` (new)

- `fetchJiraBoards(client, projectKeys) → [{ id, name, type, projectKey }]`
  - `GET rest/agile/1.0/board?projectKeyOrId=<key>&maxResults=50` for each project key.
  - Merge and de-duplicate by `id`. `type` is `scrum` or `kanban`.
  - Fails soft per project: a project whose call fails contributes no boards.
- `fetchJiraBoardColumns(client, boardId, statusNameById) → [{ name, statuses: [statusName] }]`
  - `GET rest/agile/1.0/board/{boardId}/configuration`; read `columnConfig.columns[]`, each `{ name, statuses: [{ id }] }`.
  - Map each status id to a name through `statusNameById`; drop ids that can't be mapped.
  - Keep columns that end up with no statuses: they're real board columns and render empty.
  - Throws on HTTP failure, so the caller can fall back (see §3).
- `jiraColumnForStatus(columns, statusName) → column | null` (pure): case-insensitive match on status name.

### 1.2 Status ids in metadata

`fetchJiraMetadata` (`jira/metadata.js`) already reads `project/{key}/statuses`, which includes each status's `id`. It additionally records `statusNameById: { [id]: name }` on `JiraMeta`. `emptyJiraMeta()` and `fillMetadataFromIssues` gain the field. `fillMetadataFromIssues` uses `fields.status.id` where present.

### 1.3 Config

`makeJiraConfig` (`jira/config.js`) adds `boardId` (string, default `''`) to `getJiraConfig` / `saveJiraConfig`. It's stored under `getProfileKey('jira.boardId')` like the other `jira.*` keys.

### 1.4 Loading

`loadJiraData` (`jira/loader.js`):
- When `config.boardId` is set, it calls `fetchJiraBoardColumns(client, config.boardId, meta.statusNameById)` after the issue search.
- It publishes `BOARD_COLUMNS: [{ name, statuses }]` and `BOARD_ID` on the Jira data.
- On failure it publishes `BOARD_COLUMNS: null` and `BOARD_ERROR: '<message>'`. A board failure never fails the whole load.
- The board columns are fetched on every full load and every refresh. It's one cheap call, and it keeps the layout in step with Jira board edits.
- Changing `boardId` doesn't need a separate invalidation, because the columns are fetched every load.

### 1.5 Merge

`mergeWorkItemData` (`workitems/merge.js`) passes through `JIRA_BOARD_COLUMNS` (from `jira.BOARD_COLUMNS`, else `null`) and `JIRA_BOARD_ERROR`.

### 1.6 Settings (desktop)

`JiraConnectionCard` (`apps/desktop/src/jira-settings.jsx`):
- After a successful **Test connection**, it calls `fetchJiraBoards` for the entered project keys and fills a **Board** select.
- The first option is **"Status columns (default)"** (value `''`), followed by `<board name> (<projectKey>, <type>)`.
- The current value comes from `getJiraConfig().boardId`. Save persists `boardId` with the other fields, and the existing save path already clears the Jira cache and refreshes.
- If the board list fails to load, the select shows only the default option, with a hint: "Couldn't load boards".

## 2. Board behaviour on the Jira tab

All changes are in `packages/ui/src/views/view-workitems.jsx` unless stated otherwise.

### 2.1 Lanes

When the active source is Jira (`activeSource === 'jira'`, or Jira is the only provider) and `NexusMDData.JIRA_BOARD_COLUMNS` is a non-empty array:
- **Lanes:** one lane per board column, in board order, with `lane.key = column name` and the label equal to the column name.
- **Placement:** a card sits in the lane given by `jiraColumnForStatus(columns, item.state)`.
- **Other lane:** cards with no matching column go into a trailing lane keyed `__other__`, labelled **Other**. It renders only when at least one card would be in it.
- **Status chips:** cards keep showing their status chip (as in category mode), so different statuses within one column are distinguishable.
- **Grouping:** swimlane grouping (assignee, project, priority, type) works unchanged.

This adds a third lane mode, `'jira-columns'`, next to the existing `'state'` and `'category'` modes. In BoardLanes:
- lane membership uses the column lookup above;
- lane colours fall back to the neutral lane colour.

When the condition isn't met, the Jira tab keeps today's per-status lanes.

### 2.2 Drag: dimming

When a Jira card starts dragging, the existing `availableTargetStates(id)` call returns the reachable status names. A column is reachable if any of its statuses is reachable, or if it contains the card's current status. Unreachable columns are dimmed with the existing opacity style. The Other lane is never a drop target: it is always dimmed during a drag, and drops on it are ignored.

### 2.3 Drop

Dropping a card on a column:
1. If the card's current status is already in the column, do nothing.
2. Otherwise call `workItemSource.moveToStatuses(id, column.statuses, item)`.
3. On success, update the item with the returned `{ state, stateCategory }`.
4. On failure, show a toast with the error and leave the card in place. This is the same pattern as the category drop.

`moveToStatuses` is a new optional method, routed like `moveToCategory`:
- **Router:** `createRoutedWorkItemSource` (`packages/ui/src/views/work-item-source.js`) adds `moveToStatuses`. A source that lacks it rejects with "Moving between columns is not supported for this item".
- **Jira source:** `createJiraWorkItemSource` (`apps/desktop/src/jira-client.js`) implements it with a new core helper.
- **Core helper:** `transitionJiraIssueToAny(client, key, statuses, { currentState })` in `jira/issues.js`.
  - It lists the transitions, then picks the first transition whose `toName` matches the column's statuses, trying them in column order (case-insensitive).
  - It posts that transition and returns `{ state, stateCategory }`.
  - If nothing matches, it throws `No transition from "<current>" to any status in this column`.

The context bar (`DragContextBar`) in this mode lists the column names as targets, using the same drop handler.

### 2.4 Unchanged

The ADO tab, merged mode, table view, profiles without a board, the web and Android apps, and the Board Columns settings card (still ADO-only).

## 3. Errors

- **Board configuration fetch fails** (board deleted, access lost, network error): the Jira tab falls back to per-status lanes. The provider status pill shows `Jira board unavailable — using status columns` via `JIRA_BOARD_ERROR`. This is a warning, not an error: Jira items still load.
- **Board list fails in Settings:** the select shows only the default option, with the hint above.
- **Drop with no matching transition:** toast with the core error message; the card stays put.

## 4. Testing

- **Core** (`packages/core/tests/jira/boards.test.js`):
  - board list merging and de-duplication across projects, and soft failure per project;
  - column mapping from status id to name, dropping unknown ids and keeping empty columns;
  - a configuration fetch failure throws;
  - `jiraColumnForStatus` is case-insensitive and returns null for no match.
- **Core:** `metadata.test.js` covers `statusNameById` from project statuses and from issues.
- **Core:** `issues.test.js` covers `transitionJiraIssueToAny`: column order respected, case-insensitive, no-match error, nothing posted when no transition matches.
- **Core:** `loader.test.js` covers `BOARD_COLUMNS` when `boardId` is set; `BOARD_COLUMNS: null` plus `BOARD_ERROR` on failure without failing the load; no Agile call when `boardId` is empty.
- **Core:** `config.test.js` covers the `boardId` round-trip.
- **Core:** `merge.test.js` covers passing through `JIRA_BOARD_COLUMNS` and `JIRA_BOARD_ERROR`.
- **UI** (`packages/ui/tests/workitems-board-columns.test.jsx`):
  - the Jira tab renders the board's column names in order;
  - a card lands in the column containing its status;
  - the Other lane appears only for unmapped statuses;
  - dropping on a column calls `moveToStatuses` with that column's statuses;
  - a drop with the card already in the column is a no-op;
  - a failed move shows a toast;
  - dimming follows `availableTargetStates`;
  - no board columns means per-status lanes, as today.
- **UI:** `work-item-source-routing.test.js` routes `moveToStatuses` and rejects when it's unsupported.
- **Desktop:** `jira-client.test.js` covers `moveToStatuses` delegating to the core helper.
- **Desktop:** `jira-settings.test.jsx` covers the Board select filling after Test connection, the default option, saving `boardId`, and the board-list failure hint.
- **Manual:** pick a real board in Settings and check the Jira tab's columns match Jira. Then drag a card between columns that share a workflow step and check the status changes in Jira.
