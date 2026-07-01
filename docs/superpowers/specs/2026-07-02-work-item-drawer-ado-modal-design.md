# New Work Item Drawer — Azure DevOps Modal Look Design

**Date:** 2026-07-02
**Scope:** `packages/ui/src/app-components.jsx` (`Drawer`), `apps/desktop/src/create-work-item-drawer.jsx`, `apps/desktop/src/create-work-item-drawer.test.jsx`, `packages/ui/src/styles/base.css`

## Background

`CreateWorkItemDrawer` (built in [2026-07-01-create-work-item-drawer-design.md](2026-07-01-create-work-item-drawer-design.md)) is a resizable slide-out `<Drawer>` with a plain text header (`New {type}`), a two-column body (main markdown fields + right-rail metadata), and stacked full-width sections for Attachments and Links. Azure DevOps' own work item form reads differently: a large editable title next to the type icon and a State pill on the same row, a tab strip (Details / Discussion / Links / Attachments / History) below the header, and more breathing room overall. This design restyles and restructures the drawer to match that look, without changing its create-flow behavior (field fetching, validation, submit) from the prior design.

`Drawer` is shared by four other consumers (`apps/app/src/app.jsx`, `apps/web/src/app.jsx`, `packages/ui/src/planner/planner-editors.jsx`, and other `apps/desktop/src/main.jsx` drawers), so its changes must be additive and default to today's behavior.

---

## Section 1 — `Drawer` shell: two new optional props

In `packages/ui/src/app-components.jsx`:

- `headerContent` (node, optional): when provided, renders in place of the default `<h2>{title}</h2>{badges}` pair inside `.drawer-head`. `actions` and the close button still render after it, unchanged. When omitted, existing consumers are pixel-identical to today.
- `defaultWidth` (number, optional, default `560`): used as the fallback in the `useState` initializer (`parseInt(storage.getItem(widthKey) || String(defaultWidth), 10)`) so a drawer can open wider the first time before any width is stored, without changing the shared `widthKey` storage behavior or the `DRAWER_MIN`/`DRAWER_MAX` bounds (280/2000, unchanged). Once a user resizes any drawer, that stored width wins for all drawers in the namespace, same as today.

`title` and `badges` remain accepted props (for other consumers) but are ignored when `headerContent` is passed.

---

## Section 2 — Header row

`CreateWorkItemDrawer` passes `defaultWidth={820}` and builds `headerContent` inline, replacing the current `title`/`badges` props:

- `<TypeIcon type={adoTypeToHelm(typeName)} />`, sized larger (20px vs. today's inline 13px badge use) to read as the form's primary icon.
- A borderless title `<input>` (`font-size: 18px; font-weight: 600; border: none; background: transparent; flex: 1; min-width: 0`), bound to the existing `wiTitle`/`setWiTitle` state — same field, just moved and restyled out of the body's `SettField` block. `autoFocus` and the existing required-title validation (`titleError`) are unchanged; the error text renders just below the header row instead of below the old body field.
- A `State` field `<select>`, styled as a rounded pill (reusing `.pill`-like styling: `border-radius: 999px; padding: 2px 12px`), placed after the title, before the existing refresh action button. This is the *only* place State appears — it is removed from the right rail's status field group (Section 3).

The State field only exists once `defs` has loaded and a `State`-bucket field (`fieldGroup(f) === 'status'` with `referenceName === 'System.State'`) is present; until then the pill is omitted (no layout placeholder), matching how the rest of the form already waits on `defs`.

---

## Section 3 — Tab strip (new)

A small local tab bar renders directly under the header, using the same visual language as the existing `tabStyle()` helper (Write/Preview toggle in `MarkdownField`) but as a full-width row with an underline-style active indicator instead of pill buttons, to read more like ADO's tabs:

```
Details | Discussion | Links | Attachments | History
```

- Implemented as local state (`const [tab, setTab] = useState('details')`) and a small inline `WiTab` button component — no new shared `Tabs` component in `packages/ui`, since this is the only consumer today.
- **Details** (default): today's top strip (Project/Type selects) + two-column grid, *minus* the Links and Attachments sections (moved to their own tabs) and *minus* the State field from the status group (moved to header, Section 2). Status group now holds Reason (and any other non-State status fields); Classification, Planning, Tags groups and Additional Fields are unchanged from today.
- **Links**: today's Links section content, verbatim, just relocated under this tab instead of stacked below the grid.
- **Attachments**: today's Attachments section content, verbatim, relocated the same way.
- **Discussion** and **History**: rendered as disabled tab buttons (`disabled`, reduced opacity, `title="Available after the item is created"`) — not clickable, no panel content, since comments/history don't exist until the item is created (consistent with the prior design's "Out of scope" note that ADO's own create form doesn't support pre-creation discussion either).

Switching tabs only toggles which panel is visible — no field state is reset or lost when moving between tabs (all values stay in the existing `values`/`links`/`attachmentFiles` state regardless of active tab).

---

## Section 4 — Bottom action bar

Unchanged: the sticky `Create` / `Cancel` buttons and status text stay exactly as implemented today, visible regardless of active tab (they sit outside the tab panels, same as today's sticky footer sits outside the scrollable sections).

---

## Section 5 — Styling additions

New rules added to `packages/ui/src/styles/base.css` (or inline styles in `create-work-item-drawer.jsx`, consistent with the file's existing mix of `className` for shared patterns and inline `style` for one-off layout — new additions follow that same split):

- `.wi-drawer-header` flex row styling (icon, title input, state pill, gap/alignment).
- `.wi-tabs` row + `.wi-tab` / `.wi-tab.active` / `.wi-tab:disabled` styles (underline indicator, disabled dimming).

No changes to `.drawer`, `.drawer-head`, `.drawer-body`, or `.drawer-section` base rules — those stay shared and unaffected.

---

## Out of scope

- Any change to `Drawer`'s resize/backdrop/escape-key behavior.
- Populating real Discussion or History content — those tabs stay disabled placeholders (see Section 3).
- Changes to the create/submit/attachment/link API flow from the prior design — this is a visual/structural pass only.
- Widening other drawers in the app — only `CreateWorkItemDrawer` passes `defaultWidth`.
