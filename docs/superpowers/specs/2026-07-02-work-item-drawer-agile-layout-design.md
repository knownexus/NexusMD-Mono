# Work Item Drawer — Example Agile Process Layout Design

**Date:** 2026-07-02
**Scope:** `apps/desktop/src/ado-workitem-types.js`, `apps/desktop/src/create-work-item-drawer.jsx`, their test files

## Background

`CreateWorkItemDrawer` currently groups fields generically: any `html`-bucket field (matched by a fixed reference-name set or `dataType === 'html'`) renders in the wide left column via `MarkdownField`; everything else renders in a narrow 280px right rail, bucketed into unlabeled `status`/`classification`/`planning`/`tags` groups by `fieldGroup()` (`ado-workitem-types.js:100-127`), with anything unmatched falling into a collapsible "Additional Fields" section.

This doesn't match Example's actual Azure DevOps process template. The user supplied the real per-type field layout (5 types: Bug, Epic, Feature, Issue, Task), each split into a Left column (stacked multi-line text fields) and a Middle column (Acceptance Criteria, then a Planning group of compact fields). A Right column exists in ADO's own UI (Deployment, Links/Related Work, and a redundant System Info entry) but per user decision none of it needs new UI: Deployment is omitted (no build/release data exists pre-creation, same reasoning as the already-disabled Discussion/History tabs), Related Work is the existing Links tab, and the right-column "System Info" entry was a transcription duplicate of the one already in the left column.

---

## Section 1 — Per-type layout config

New export in `ado-workitem-types.js`, alongside the existing `HTML_FIELDS`/`KNOWN_FIELD_GROUPS` constants:

```js
export const TYPE_LAYOUTS = {
  Bug: {
    left: ['Description', 'Repro Steps', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Resolved Reason', 'Story Points', 'Priority'],
  },
  Epic: {
    left: ['Description', 'Stages'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk', 'Effort'],
  },
  Feature: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk'],
  },
  Issue: {
    left: ['Description'],
    middleTop: null,
    planning: ['Area', 'Stack Rank', 'Priority', 'Due Date'],
  },
  Task: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Activity'],
  },
}
```

Keyed by work item **type name** (`defs.types[].name`, e.g. `"Bug"`), not reference name — matches how `typeName` is already derived in `create-work-item-drawer.jsx:166`.

Fields are matched by **display name** (`field.name`), not reference name: the transcribed layout gives display labels, and several fields (Resolved Reason, Risk, Effort, Stack Rank, Activity, Stages) are custom or ambiguous enough that hardcoding a guessed reference name risks a silent, permanent mismatch if wrong. A wrong or missing display-name match just drops that field into the existing "Additional Fields" catch-all — visible, editable, never lost, never a crash.

**Assumptions on record** (per user sign-off):
- Bug's `Priority` is Integer, matching every other type in this template.
- "System Info" is a single field; the right-column "System Info" group in the user's transcription was a duplicate mention of the same left-column field, not a second thing.
- "Related Work" refers to the same data as the drawer's existing Links tab — no new UI.
- The Deployment group (Deployments/Development) is omitted entirely from the create flow — it has no data before the item exists.

---

## Section 2 — Layout: Details tab becomes two equal columns

`create-work-item-drawer.jsx:263` currently renders `display: grid; grid-template-columns: 1fr 280px` (wide main column + narrow rail). This changes to `1fr 1fr` (Left / Middle) for types with a `TYPE_LAYOUTS` entry, because Acceptance Criteria needs the same `MarkdownField` treatment as Description — a 280px rail can't hold it.

**Left column:** for each display name in `TYPE_LAYOUTS[typeName].left`, find the matching field in `fields` (by `f.name`) and render it via the existing `MarkdownField` component, in the config's order. Fields with no match are skipped (not rendered as blank).

**Middle column:**
1. If `middleTop` is set and a matching field exists, render it via `MarkdownField` first (Acceptance Criteria).
2. Below it, a single unlabeled `drawer-section` (matching today's no-header convention for the status/classification/planning/tags groups) holding one `FieldInput` per display name in `planning`, in order, for fields that have a match.
3. Below that, the existing "Additional Fields" collapsible section, now containing every field that isn't the Title, the header's State field, or matched by `left`/`middleTop`/`planning` — this is a strict superset of today's "additional" bucket, so nothing that used to be visible becomes hidden.

**Right column: removed.** No third grid column, no Deployment section — per the design decision above.

---

## Section 3 — Fallback for types outside `TYPE_LAYOUTS`

When `typeName` has no entry in `TYPE_LAYOUTS` (a project using a different process template, or a 6th type added later to this one), the Details tab renders exactly as it does today: `mainFields`/`statusFields`/`classificationFields`/`planningFields`/`tagsFields`/`additionalFields` via `fieldGroup()`, `1fr 280px` grid. This is a pure fallback path — `fieldBucket`/`fieldGroup`/`KNOWN_FIELD_GROUPS` are unchanged, so no existing behavior regresses for any project not on Example's Agile template.

---

## Out of scope

- Verifying custom fields' actual ADO reference names (Resolved Reason, Risk, Effort, Stack Rank, Activity, Stages) — the name-matching strategy in Section 1 makes this unnecessary for correctness, only for completeness of the per-type columns (a mismatch degrades to "Additional Fields", not breakage).
- Any Deployment/Development UI, in any form — explicitly excluded per the design decision.
- Changes to `fieldBucket`'s widget-selection logic (picklist/treePath/identity/dateTime/boolean/number/text/html) — the new layout only changes *where* fields render, not *how* each one renders.
