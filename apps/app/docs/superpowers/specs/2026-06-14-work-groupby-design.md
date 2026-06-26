# Work Page Group By — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Overview

Add group-by functionality to `WorkItemsView` (`src/views/view-workitems.jsx`). Users can group work items by **User**, **Project**, or **Status** in both list and board views. The control lives inside the existing filter sheet.

## State

A single `groupBy` variable — `null | 'user' | 'project' | 'status'` — lives in `WorkItemsView` and is shared across list and board view modes. Switching view modes does not reset grouping.

## Filter Sheet Changes

- A "Group by" section is added at the top of the filter sheet, above the existing Type / State / Assignee sections.
- Rendered as a radio group: **None · User · Project · Status**.
- Selecting a radio does not close the sheet; user taps "Show X" to apply.
- The filter button badge count reflects only Type / State / Assignee filter selections — grouping does not increment the badge.

## List View Behaviour

| groupBy | Behaviour |
|---------|-----------|
| `null` | Current flat list (no change) |
| `'user'` | Collapsible group headers per assignee, alphabetical by first name; Unassigned last |
| `'project'` | Collapsible group headers per project, alphabetical |
| `'status'` | Collapsible group headers in fixed order: To Do → Active → Blocked → In Review → Done |

- Empty groups are hidden.
- Each group header shows the group label and item count (e.g., `Alice [4]`).
- Tapping a group header collapses/expands its items.
- All groups start expanded.

## Board View Behaviour

| groupBy | Behaviour |
|---------|-----------|
| `null` or `'status'` | Current 5-lane layout (To Do / Active / Blocked / In Review / Done) — no change |
| `'user'` | Lanes keyed per assignee, alphabetical; plus an Unassigned lane at the end |
| `'project'` | Lanes keyed per project, alphabetical |

- Lane count is dynamic; all lanes scroll horizontally as today.
- Lane headers and card structure are unchanged — only the lane-key changes.
- Within each lane, cards are ordered by priority then updated time (same as current status board).

## Files to Change

- `src/views/view-workitems.jsx` — add `groupBy` state, filter sheet section, list grouping logic, board lane derivation
- `public/css/helm-mobile.css` — group header styles for list view (if not already covered by existing card/section styles)
