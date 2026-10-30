# Profiles Design

**Date:** 2026-06-14
**Status:** Approved

## Overview

Add multi-profile support to Helm so a single device can hold multiple fully-isolated management contexts — different Azure DevOps orgs, different client workspaces, or manual (no-DevOps) setups for non-development teams. Profiles are stored locally on-device (localStorage) with export/import for portability.

---

## Goals

- Switch between completely isolated workspaces (ADO org, planner data, team, appearance) without reinstalling
- Support manual profiles for non-development managers (planner + team + custom lists)
- Export a profile to a portable JSON blob; import it on another device
- Zero disruption for existing single-profile users (automatic migration)

## Non-goals

- Server-side profile sync (device-first only)
- Infinite custom field types (fixed set of nine)
- Multi-level sub-item nesting (one level only: item → sub-items)
- Cross-profile data sharing

---

## Data Model

### Profile metadata

Stored in `localStorage` key `helm.profiles` as a JSON array:

```json
[
  {
    "id": "abc123",
    "name": "Example Engineering",
    "color": "#9a7e22",
    "initials": "MS",
    "type": "ado",
    "createdAt": 1718000000
  },
  {
    "id": "def456",
    "name": "HR Team",
    "color": "#7c7c7c",
    "initials": "HR",
    "type": "manual",
    "createdAt": 1718001000
  }
]
```

`type` is either `"ado"` (Azure DevOps connected) or `"manual"` (no DevOps).

Active profile tracked separately in `helm.activeProfileId` (string, profile `id`).

### Per-profile data keys

All existing `helm.X` keys become `helm.p.{id}.X`. Examples:

| Old key | New key |
|---|---|
| `helm.tweaks` | `helm.p.abc123.tweaks` |
| `helm.planner.week.2026-W24` | `helm.p.abc123.planner.week.2026-W24` |
| `helm.profile.displayName` | `helm.p.abc123.profile.displayName` |
| `helm.team.custom` | `helm.p.abc123.team.custom` |
| ADO config (org, PAT, projects) | `helm.p.abc123.android.*` |

### Export blob format

```json
{
  "version": 1,
  "profile": { "name": "Example Engineering", "color": "#9a7e22", "initials": "MS", "type": "ado" },
  "data": {
    "tweaks": { "theme": "light", "density": "balanced" },
    "planner.week.2026-W24": { ... },
    "profile.displayName": "Phil"
  }
}
```

Keys in `data` are stripped of the `helm.p.{id}.` prefix for portability. On import, they are re-prefixed under a fresh generated ID.

### Custom lists data (manual profiles only)

Stored at `helm.p.{id}.lists`:

```json
{
  "lists": [
    {
      "id": "lst1",
      "name": "Initiatives",
      "color": "#6c8ebf",
      "fields": ["title", "owner", "status", "due", "priority", "notes"],
      "statuses": ["Not started", "In progress", "Done", "Blocked"],
      "items": [
        {
          "id": "i1",
          "title": "Onboarding revamp",
          "owner": "Sarah",
          "status": "In progress",
          "due": "2026-06-30",
          "priority": "P1",
          "notes": "",
          "children": [
            { "id": "i1a", "title": "Draft new hire checklist", "owner": "Sarah", "done": true },
            { "id": "i1b", "title": "Schedule stakeholder review", "owner": "Tom", "done": false }
          ]
        }
      ]
    }
  ]
}
```

---

## Architecture

### ProfileContext (`src/profile-context.jsx`)

A new React context wrapping the entire app. Provides:

- `activeProfile` — current profile metadata object
- `profiles` — full list of profiles
- `profileKey(key)` — returns `helm.p.{id}.{key}` for the active profile
- `switchProfile(id)` — writes `helm.activeProfileId`, triggers data reload
- `createProfile(opts)` — generates ID, writes to `helm.profiles`
- `deleteProfile(id)` — removes all `helm.p.{id}.*` keys, updates list
- `exportProfile(id)` — serialises to blob, triggers file download
- `importProfile(file)` — parses blob, creates new profile, does not auto-switch

A module-level `getProfileKey(key)` helper reads `helm.activeProfileId` directly from localStorage — used in `data.jsx` and anywhere outside React (e.g. `adoGet`, confidential config).

`ado-client.js`'s `KEYS` constant (currently hardcoded `helm.android.*` strings) is updated to call `getProfileKey('android.org')` etc., making all ADO config reads/writes automatically profile-scoped.

### localStorage access

`usePrefVS` and all direct `localStorage.getItem/setItem` calls in the app are updated to use `getProfileKey(key)` instead of raw key strings. This is the only required change to existing hooks.

### Data loader (`data.jsx`)

On `switchProfile`, the existing reload pipeline re-runs:
- For `type: "ado"` profiles: normal ADO fetch using the profile's own org/PAT/projects
- For `type: "manual"` profiles: ADO fetches are skipped; `HelmData` is populated with empty collections so no view breaks

### Navigation

`app.jsx` derives `PRIMARY_TABS` and `SECONDARY_TABS` from `activeProfile.type` at render time:

| Tab | ADO profile | Manual profile |
|---|---|---|
| Dashboard | Simplified ADO dashboard | Planner glance / quick summary |
| Work items | Full ADO view | Hidden |
| PRs | Full ADO view | Hidden |
| Builds | Full ADO view | Hidden |
| Tests | Full ADO view | Hidden |
| Triage | Full ADO view | Hidden |
| Lists | Hidden | Custom lists view |
| Planner | ✓ | ✓ |
| Team | ✓ | ✓ |
| Calendar | ✓ | ✓ |
| Settings | ✓ | ✓ |

---

## UI

### Settings → Profiles sub-page

A new `profiles` entry added to the Settings rail (between Planner and Confidential). Contains:

- List of profiles: active one highlighted with accent border + "Active" chip; others show "Switch" and "Edit" buttons
- "Import profile from file…" row at the bottom
- "+ New profile" button top-right

### Edit / New profile sheet (PlModal)

Fields:
- Profile name (text input)
- Initials (short text, 2 chars)
- Type toggle: Azure DevOps | Manual
- Organisation (shown only for ADO type) — same field as existing SettingsModal
- Colour picker (small swatch set)
- Actions: Export, Delete (with confirmation), Cancel, Save

### Profile switch behaviour

1. User taps "Switch" on a non-active profile
2. Toast: "Switching to [name]…"
3. `switchProfile(id)` writes `helm.activeProfileId`
4. `window.helmReload?.()` re-runs data pipeline
5. Nav tabs update to reflect new profile type
6. App lands on Dashboard

---

## Custom Lists (Manual profiles)

### Views

**List detail** — items in a table/list layout. Each item shows configured fields as columns. Items can be expanded to show sub-items (one level). Inline add row at the bottom. Toggle to Board view.

**Board** — kanban columns across all lists in the profile. Status labels are mapped to four display buckets using case-insensitive keyword matching: "Not started" (default for unknowns), "In progress" (matches: active, in progress, started, doing), "Done" (matches: done, complete, closed, finished), "Blocked". Any status that doesn't match a keyword falls into "Not started". Cards show title, list name, owner.

**My items** — filters all items across all lists where `owner` matches the profile's display name. Grouped by list.

### Field types

Available fields per list (toggled when creating/editing a list):

| Field | Type | Notes |
|---|---|---|
| Title | Text | Always present, not removable |
| Status | Select | Labels configurable per list |
| Owner | Text / team member | Free text or pick from team |
| Notes | Multiline text | — |
| Due date | Date | Flatpickr |
| Priority | Select | Fixed: P1 / P2 / P3 / P4 |
| Number | Numeric | e.g. budget, headcount |
| URL | Text | Rendered as clickable link |
| Checkbox | Boolean | Toggle, shown as ✓/— |

### Sub-items

One level deep only. Each sub-item has: title, owner, done (boolean). Sub-items do not have their own status — they inherit the parent's list statuses but use `done` for simplicity.

---

## Migration

**First-run (automatic, one-time):**

1. On app load, check `helm.activeProfileId`
2. If absent: read existing ADO config (`helm.android.*` keys) and all other `helm.*` keys
3. Create profile: `{ id: generateId(), name: existingOrg || "My Workspace", type: existingOrg ? "ado" : "manual" }`
4. Copy every `helm.X` key → `helm.p.{id}.X`
5. Write `helm.profiles` and `helm.activeProfileId`
6. A timestamp `helm.migrated` is written with the current date. On each subsequent app load, if `helm.migrated` is older than 30 days, the original unprefixed `helm.*` keys (excluding `helm.profiles`, `helm.activeProfileId`, `helm.migrated`) are deleted from localStorage.

**No user action required.** Existing users land in their migrated profile as if nothing changed.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| Delete only profile | Blocked — must have at least one profile |
| Import invalid file | Toast: "Not a valid Helm profile file." — no changes made |
| Import duplicate name | Allowed — a new ID is generated, name kept as-is |
| Switch while data loading | Loading indicator shown; reload cancels in-flight requests |
| localStorage full on import | Toast: "Not enough storage to import this profile." |
| Manual profile visits ADO view URL directly | Redirected to Dashboard |

---

## Testing (visual, npm run dev)

1. Create two ADO profiles with different orgs — verify data isolation (tweaks, team, planner weeks are independent)
2. Create a manual profile — verify ADO tabs are hidden, Lists tab appears
3. Add a list with sub-items to the manual profile — switch away and back, verify data persists
4. Export profile 1 — import as new profile — verify data copied, new ID generated, original unchanged
5. Delete imported profile — verify `helm.p.{id}.*` keys removed from localStorage
6. Clear `helm.activeProfileId` from devtools — reload — verify migration runs once and existing data is preserved
