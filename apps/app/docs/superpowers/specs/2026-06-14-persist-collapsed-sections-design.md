# Persist Collapsed/Expanded Section State

**Date:** 2026-06-14
**Status:** Approved

## Problem

Group section collapse state in Builds, Tests, Triage, and Work Items resets on every navigation. Users who collapse noisy groups must redo this every session.

## Solution

Swap `useState` for `usePersisted` in each of the four views. `usePersisted` is already defined in `components.jsx` and handles both plain objects and Sets via `localStorage` under a profile-scoped key.

## Changes

| File | State var | Type | localStorage key | Extra |
|---|---|---|---|---|
| `src/views/view-builds.jsx` | `collapsed` | `{}` | `helm.builds.collapsed` | — |
| `src/views/view-tests.jsx` | `collapsed` | `{}` | `helm.tests.collapsed` | — |
| `src/views/view-triage.jsx` | `collapsed` | `{}` | `helm.triage.collapsed` | Add `useEffect(() => setCollapsed({}), [groupBy])` |
| `src/views/view-workitems.jsx` | `collapsedGroups` | `Set` | `helm.workitems.collapsed` | Keep existing clear-on-groupBy effect |

## Behavior

- Collapsed state persists across navigation and app restarts.
- Switching `groupBy` in Triage or Work Items clears the collapsed state (consistent with current WI behavior; avoids stale group keys from prior groupings).
- No new infrastructure — `usePersisted` already handles Set serialisation.

## Out of Scope

- Per-groupBy memory (remembering state separately for each groupBy option) — deferred.
- Dashboard widget collapse, settings card collapse — not requested.
