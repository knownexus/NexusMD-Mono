# Mobile & Tablet Redesign — Design Spec

**Date:** 2026-06-14  
**Status:** Approved  
**Primary target:** Samsung Galaxy Tab S7 (SM-T870), portrait, ~800dp wide  
**Secondary target:** Android phones, portrait, ≤600dp wide  
**Desktop:** Out of scope — the app never runs in a browser  

---

## 1. Goals

1. Fix touch targets: all interactive elements must be ≥44px tall/wide
2. Fix modals/panels: dialogs must never overflow or feel cramped on device
3. Make navigation configurable from the Tweaks panel
4. Apply a consistent phone-vs-tablet layout across every view

---

## 2. Layout System

### Breakpoints

Two breakpoints only. No desktop.

| Name   | Width    | Behaviour |
|--------|----------|-----------|
| Phone  | ≤ 600px  | Base styles. Single-column. Full-screen modals. Bottom sheet for details/dropdowns. |
| Tablet | ≥ 601px  | Enhanced layout. Two-column grids where appropriate. Slide-over side panel for details. Sidebar navigation. |

### Touch Targets — Global CSS Pass

A single CSS rule applied to every interactive element (buttons, list rows, nav items, tab/section headers, icon buttons):

```css
min-height: 44px;
min-width: 44px;
```

Adjacent touch targets must have ≥8px spacing so hits don't bleed into neighbours. This pass covers every view file.

---

## 3. Navigation

### Configurable via Tweaks Panel

The existing `sidebar` tweak is extended with a third value. The Tweaks panel gains a new "Navigation Style" 3-way control:

| Tweak value | Label | Behaviour |
|-------------|-------|-----------|
| `"labels"`  | Labels | 130px sidebar, icon + text label per item |
| `"icons"`   | Icons  | 56px icon rail, icon only, tooltip on long-press |
| `"bottom"`  | Bottom | Full-width content, 52px bottom tab bar, 5 primary tabs + "More" overflow |

### Auto-Default Logic (first launch / no saved preference)

- Screen width ≤ 600px → default `"bottom"`
- Screen width ≥ 601px → default `"labels"`

User can override at any time via Settings → Tweaks.

### Label Sidebar (130px)

- Width: 130px
- Items: icon (13px) + label (11px), min-height 44px per item
- Active item: filled highlight swatch, accent colour text
- Bottom-pinned: Settings item
- Border-right: 1px separator

### Icon Rail (56px)

- Width: 56px
- Items: icon centred, min-height 44px
- Active item: accent-coloured icon, small filled background pill
- Long-press shows label tooltip

### Bottom Tab Bar (52px)

- Height: 52px, pinned to bottom
- 5 primary destinations: Dashboard, Work Items, Planner, PRs, More
- "More" opens a bottom sheet listing remaining views (Builds, Tests, Team, Calendar, Triage, Settings)
- Active tab: accent-coloured icon + label
- Inactive tabs: muted icon + label

---

## 4. Modal & Panel System

### Phone (≤600px) — Bottom Sheet

All detail panels, filter dropdowns, and dialogs slide up from the bottom:

- Drag handle bar at top (36px wide, 3px tall, centred)
- Corner radius: 12px top corners only
- Swipe-down or tap-backdrop to dismiss
- Height: auto up to 85vh, scrollable if content overflows
- Backdrop: rgba black at 60% opacity

Applies to: work item detail, PR detail, build log, triage item, settings modal, filter/sort panels.

### Tablet (≥601px) — Slide-over Side Panel

Detail opens as a panel occupying the right ~55% of the content area, pushing (not overlaying) the list:

- List shrinks to ~45% width, remains visible and scrollable
- Panel slides in from right with a subtle transition (200ms ease-out)
- Close button (✕) top-right of panel, min 44px tap target
- No backdrop — content stays interactive

Applies to: work item detail, PR detail, triage item.

### Tablet Dialogs (settings, confirmations)

Centred modal, max-width 560px, border-radius 12px, backdrop dimmed. Not full-screen — the Tab S7 has enough space for a contained dialog.

---

## 5. View-Level Patterns

### Dashboard

- Phone: single-column widget stack, full width
- Tablet: 2-column widget grid (existing behaviour — already works, just needs touch-target pass on widget grab handles and widget header buttons)
- Widget drag handles: min 44px tap area

### Work Items

- Phone: list full width → tapping item opens bottom sheet detail
- Tablet: list (45% width) + side panel (55% width) — split view, both visible
- Filter/sort bar: buttons min 44px; filter dropdown → bottom sheet on phone, inline dropdown on tablet
- Row height: min 44px

### Planner

- Phone: single-day column view, swipe left/right to change day
- Tablet: 5-day week view (existing behaviour)
- Nav arrows (prev/next week): min 44px
- Time slot rows: min 44px height

### PRs, Builds, Tests, Triage, Team, Calendar

- Touch target pass (44px rows, buttons, tabs)
- Detail: bottom sheet on phone, side panel on tablet (same pattern as Work Items)
- No other structural changes — these views are not primary usage targets

### Settings

- Phone: full-screen slide-over
- Tablet: centred modal, max-width 560px

---

## 6. CSS Architecture

All changes are additive — existing styles remain as the base, mobile-first overrides applied via `@media (min-width: 601px)` for tablet enhancements.

Key files to update:
- `index.html` / global stylesheet — touch target base rule, CSS variables for nav widths
- `src/app.jsx` — nav shell, breakpoint detection for auto-default, Tweaks panel nav control
- `src/components.jsx` — modal/sheet component, bottom sheet component, side panel component
- `src/views/view-workitems.jsx` — split-view layout, sheet/panel wiring
- `src/planner/view-planner.jsx` & `view-planner-2.jsx` — single-day phone mode
- `src/views/view-dashboard.jsx` — widget grab handle targets
- All other view files — touch target pass only

New reusable components (added to `src/components.jsx`):
- `<BottomSheet>` — wraps any content in a swipeable bottom sheet
- `<SidePanel>` — slide-over right panel with list-push behaviour
- `<NavRail>` — renders icon rail, label sidebar, or bottom tab bar based on `tweaks.sidebar`

---

## 7. Out of Scope

- Visual theme/colour redesign (not requested)
- New data features or ADO API changes
- Desktop layout (app never runs in a browser)
- Landscape orientation (portrait is the primary use mode)
