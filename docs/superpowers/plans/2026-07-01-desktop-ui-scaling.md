# Desktop UI Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the desktop app persistent native zoom and make its layout survive small windows via a minimum window size and responsive reflow.

**Architecture:** Zoom is owned by the Electron main process (`main.cjs`), persisted in the existing `userData/prefs.json`, applied on load and on every zoom action. Small-window resilience comes from a `minWidth`/`minHeight` floor plus a width-driven sidebar collapse in the renderer and a tighter responsive tier in shared CSS. All decision logic (zoom clamping/stepping, sidebar mode) is extracted into dependency-free helper modules so it can be unit-tested; the Electron and CSS wiring is verified manually.

**Tech Stack:** Electron (main process, CommonJS `.cjs`), React (renderer, ESM `.jsx`/`.js`), Vite, Vitest + jsdom + @testing-library/react.

## Global Constraints

- No new runtime dependencies.
- Files under `apps/desktop/electron/` are CommonJS (`require`/`module.exports`); files under `apps/desktop/src/` are ESM (`import`/`export`).
- Tests run with Vitest from the `apps/desktop` directory (`npx vitest run <file>`); environment is jsdom.
- Zoom factor bounds: min `0.5`, max `2.0`, default `1.0`, step `0.1`.
- Sidebar auto-collapse breakpoint: `1024`px. Icon-rail width: `56`px.
- Minimum window size: `900` × `600`.
- The auto-collapse must NOT overwrite the user's saved `sidebar` tweak — it only changes the *rendered* mode.
- Changes to `packages/ui/src/styles/base.css` are shared and also affect the web app; keep them additive (new breakpoints only).

---

### Task 1: Zoom helper module + main-process wiring

**Files:**
- Create: `apps/desktop/electron/zoom.cjs`
- Test: `apps/desktop/electron/zoom.test.js`
- Modify: `apps/desktop/electron/main.cjs` (View menu ~97-107; `createMainWindow` `did-finish-load` ~169-197; add module-level `applyZoom` and a `require`)

**Interfaces:**
- Produces: `clampZoomFactor(f): number`, `nextZoom(current, direction): number` where `direction ∈ {'in','out'}`, and constants `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP`, `ZOOM_DEFAULT` — all exported from `electron/zoom.cjs`.
- Consumes: existing `prefs` object and `savePrefs(data)` in `main.cjs` (defined ~264-280).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/electron/zoom.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  clampZoomFactor, nextZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT,
} from './zoom.cjs'

describe('clampZoomFactor', () => {
  it('keeps in-range values', () => {
    expect(clampZoomFactor(1)).toBe(1)
    expect(clampZoomFactor(1.5)).toBe(1.5)
  })
  it('clamps to bounds', () => {
    expect(clampZoomFactor(5)).toBe(ZOOM_MAX)
    expect(clampZoomFactor(0.1)).toBe(ZOOM_MIN)
  })
  it('falls back to default for non-finite input', () => {
    expect(clampZoomFactor(undefined)).toBe(ZOOM_DEFAULT)
    expect(clampZoomFactor(NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoomFactor('x')).toBe(ZOOM_DEFAULT)
  })
})

describe('nextZoom', () => {
  it('steps in and out without floating-point drift', () => {
    expect(nextZoom(1, 'in')).toBe(1.1)
    expect(nextZoom(1, 'out')).toBe(0.9)
    expect(nextZoom(1.1, 'in')).toBe(1.2)
  })
  it('never exceeds the bounds', () => {
    expect(nextZoom(ZOOM_MAX, 'in')).toBe(ZOOM_MAX)
    expect(nextZoom(ZOOM_MIN, 'out')).toBe(ZOOM_MIN)
  })
  it('returns a clamped current value for an unknown direction', () => {
    expect(nextZoom(1.5, 'none')).toBe(1.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `npx vitest run electron/zoom.test.js`
Expected: FAIL — cannot resolve `./zoom.cjs`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/electron/zoom.cjs`:

```js
// Zoom factor bounds and pure helpers for the desktop window.
// Dependency-free so they can be unit-tested without Electron.
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1
const ZOOM_DEFAULT = 1.0

function clampZoomFactor(f) {
  const n = Number(f)
  if (!Number.isFinite(n)) return ZOOM_DEFAULT
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n))
}

function nextZoom(current, direction) {
  const base = clampZoomFactor(current)
  const delta = direction === 'in' ? ZOOM_STEP : direction === 'out' ? -ZOOM_STEP : 0
  // Round to 2dp to avoid 0.1 + 0.2 style floating-point drift.
  return clampZoomFactor(Math.round((base + delta) * 100) / 100)
}

module.exports = { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT, clampZoomFactor, nextZoom }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/desktop`): `npx vitest run electron/zoom.test.js`
Expected: PASS (3 + 3 assertions across the two describe blocks).

- [ ] **Step 5: Wire the helper into `main.cjs`**

Add the require near the other top-of-file requires in `apps/desktop/electron/main.cjs`:

```js
const { clampZoomFactor, nextZoom, ZOOM_DEFAULT } = require('./zoom.cjs')
```

Add a module-level helper (place it just above `function createMainWindow()`, ~line 138):

```js
// Apply and persist a zoom factor for the given window.
function applyZoom(win, factor) {
  const f = clampZoomFactor(factor)
  win.webContents.setZoomFactor(f)
  prefs.zoomFactor = f
  try { savePrefs(prefs) } catch { /* best-effort */ }
}
```

Replace the `View` submenu (currently ~97-107) with custom handlers so keyboard zoom persists:

```js
    {
      label: 'View',
      submenu: [
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => applyZoom(win, ZOOM_DEFAULT) },
        { label: 'Zoom In',    accelerator: 'CmdOrCtrl+=', click: () => applyZoom(win, nextZoom(win.webContents.getZoomFactor(), 'in')) },
        { label: 'Zoom Out',   accelerator: 'CmdOrCtrl+-', click: () => applyZoom(win, nextZoom(win.webContents.getZoomFactor(), 'out')) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
```

In `createMainWindow`, apply the saved zoom and wire Ctrl+scroll. Update the existing `did-finish-load` handler (~169) so its first line applies the persisted zoom, and add a `zoom-changed` listener right after it:

```js
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(clampZoomFactor(prefs.zoomFactor ?? ZOOM_DEFAULT))
    win.webContents.insertCSS(`
      html { box-sizing: border-box; }
      /* …existing inserted CSS unchanged… */
    `)
  })

  // Ctrl+mouse-wheel zoom — step our own tracked factor so it stays clamped and persisted.
  win.webContents.on('zoom-changed', (_e, direction) => {
    applyZoom(win, nextZoom(win.webContents.getZoomFactor(), direction))
  })
```

(Leave the body of the existing `insertCSS(...)` call exactly as-is; only the `setZoomFactor` line is new inside `did-finish-load`.)

- [ ] **Step 6: Manual verification (Electron wiring)**

Run (from repo root or `apps/desktop`, per project convention): `npm run dev` in `apps/desktop`.
Verify:
1. Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets to 100%.
2. Ctrl+mouse-wheel zooms and stops at 50% / 200% bounds.
3. Quit and relaunch — the last zoom level is restored.
Expected: all pass; `userData/prefs.json` contains a `zoomFactor` key.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/zoom.cjs apps/desktop/electron/zoom.test.js apps/desktop/electron/main.cjs
git commit -m "feat(desktop): persistent native zoom (Ctrl +/-/0, Ctrl+scroll)"
```

---

### Task 2: Minimum window size

**Files:**
- Modify: `apps/desktop/electron/main.cjs` (`new BrowserWindow({ … })` ~141-155)

**Interfaces:**
- Consumes: nothing. Produces: nothing (config-only change).

- [ ] **Step 1: Add the size floor**

In `apps/desktop/electron/main.cjs`, add `minWidth`/`minHeight` to the `BrowserWindow` options:

```js
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Management Dashboard',
    // …rest unchanged…
  });
```

- [ ] **Step 2: Manual verification**

Run `npm run dev` in `apps/desktop`. Try to drag the window smaller than 900×600.
Expected: the window stops at 900 wide / 600 tall and cannot go smaller.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/main.cjs
git commit -m "feat(desktop): set 900x600 minimum window size"
```

---

### Task 3: Sidebar auto-collapse helper + renderer wiring

**Files:**
- Create: `apps/desktop/src/layout.js`
- Test: `apps/desktop/src/layout.test.js`
- Modify: `apps/desktop/src/main.jsx` (`App` component: add width hook + import ~831; root `<div data-sidebar>` ~986; `<aside>` width ~988-992; `.sidebar-brand` ~993-996; nav `<button>` label/hint/badge ~997-1029; resizer `<div>` ~1030-1047)

**Interfaces:**
- Produces: `effectiveSidebar(width, pref, breakpoint?): 'icons' | 'labels'`, constants `SIDEBAR_BREAKPOINT` (1024) and `ICON_RAIL_WIDTH` (56), exported from `src/layout.js`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/layout.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { effectiveSidebar, SIDEBAR_BREAKPOINT } from './layout.js'

describe('effectiveSidebar', () => {
  it('forces icons below the breakpoint regardless of preference', () => {
    expect(effectiveSidebar(800, 'labels')).toBe('icons')
    expect(effectiveSidebar(800, 'icons')).toBe('icons')
  })
  it('honours the saved preference at or above the breakpoint', () => {
    expect(effectiveSidebar(SIDEBAR_BREAKPOINT, 'labels')).toBe('labels')
    expect(effectiveSidebar(1400, 'labels')).toBe('labels')
    expect(effectiveSidebar(1400, 'icons')).toBe('icons')
  })
  it('defaults to labels when preference is missing', () => {
    expect(effectiveSidebar(1400, undefined)).toBe('labels')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/desktop`): `npx vitest run src/layout.test.js`
Expected: FAIL — cannot resolve `./layout.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/layout.js`:

```js
// Sidebar auto-collapse logic. Below the breakpoint the rail forces icon-only
// mode regardless of the user's saved preference; at or above it, the saved
// preference wins. Pure so it can be unit-tested independently of React.
export const SIDEBAR_BREAKPOINT = 1024
export const ICON_RAIL_WIDTH = 56

export function effectiveSidebar(width, pref, breakpoint = SIDEBAR_BREAKPOINT) {
  return width < breakpoint ? 'icons' : (pref || 'labels')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/desktop`): `npx vitest run src/layout.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `main.jsx`**

Add the import alongside the other local imports (~line 18-22):

```js
import { effectiveSidebar, SIDEBAR_BREAKPOINT, ICON_RAIL_WIDTH } from './layout.js'
```

Inside `function App()`, after the existing `useState`/`usePersistedState` hooks (~line 840), add a window-width hook and derive the effective mode:

```js
  const [winWidth, setWinWidth] = React.useState(() => window.innerWidth)
  React.useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const effSidebar = effectiveSidebar(winWidth, tweaks.sidebar)
  const iconsOnly  = effSidebar === 'icons'
```

Change the app root `data-sidebar` to the effective mode (~line 986):

```js
      <div data-density={tweaks.density} data-sidebar={effSidebar}
        style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
```

Make the `<aside>` width respond to the mode (~line 988-992):

```js
        <aside style={{
          width: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          minWidth: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--surface, transparent)', position: 'relative',
        }}>
```

Hide the brand text in icons mode (~line 993-996):

```js
          <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
            <Icon name="dashboard" size={18} />
            {!iconsOnly && <strong style={{ fontSize: 14 }}>NexusMD</strong>}
          </div>
```

In the nav `<button>` map, center the icon in icons mode, hide the label + number hint, and render the change-badge as a dot. Replace the button's `style` `padding`/`justifyContent`, the `{item.label}`, the badge block, and the number-hint block (~line 997-1029):

```js
          {NAV.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              title={iconsOnly ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                justifyContent: iconsOnly ? 'center' : 'flex-start',
                gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: view === item.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
                color: view === item.id ? 'var(--accent)' : 'var(--text-muted)',
                font: 'inherit', fontSize: 13, position: 'relative',
              }}
            >
              <Icon name={item.icon} size={16} />
              {!iconsOnly && item.label}
              {changeBadges[item.id] > 0 && (
                iconsOnly ? (
                  <span style={{
                    position: 'absolute', top: 4, right: 4, width: 8, height: 8,
                    background: 'var(--accent)', borderRadius: '50%',
                  }} />
                ) : (
                  <span style={{
                    marginLeft: 'auto', minWidth: 18, height: 18,
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    borderRadius: 9, fontSize: 11, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px',
                  }}>
                    {changeBadges[item.id] > 99 ? '99+' : changeBadges[item.id]}
                  </span>
                )
              )}
              {!iconsOnly && tweaks.sidebar === 'labels' && idx < 9 && !changeBadges[item.id] && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)', opacity: 0.5 }}>
                  {idx + 1}
                </span>
              )}
            </button>
          ))}
```

Hide the drag-resizer in icons mode (it only applies to the resizable labels rail). Wrap the resizer `<div>` (~line 1030-1047):

```js
          {!iconsOnly && (
            <div
              style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 10 }}
              onMouseDown={e => {
                e.preventDefault()
                const startX = e.clientX
                const startW = sidebarWidth
                const onMove = (me) => {
                  const next = Math.max(160, Math.min(320, startW + me.clientX - startX))
                  setSidebarWidth(next)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
          )}
```

- [ ] **Step 6: Run the full desktop test suite to confirm nothing regressed**

Run (from `apps/desktop`): `npx vitest run`
Expected: PASS, including the new `src/layout.test.js` and all existing tests.

- [ ] **Step 7: Manual verification**

Run `npm run dev` in `apps/desktop`. Narrow the window below ~1024px wide.
Verify:
1. The sidebar collapses to a 56px icon-only rail (no labels, no number hints; brand shows icon only).
2. Nav items with change-badges show a small dot instead of a count pill.
3. The drag-resizer disappears while collapsed.
4. Widening back past 1024px restores the previous labels/width, and the user's Display → Sidebar tweak is unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/layout.js apps/desktop/src/layout.test.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): auto-collapse sidebar to icons in narrow windows"
```

---

### Task 4: Responsive tier for shared stats grid

**Files:**
- Modify: `packages/ui/src/styles/base.css` (after the `.stats` breakpoint ~671; verify table overflow ~888)

**Interfaces:**
- Consumes/Produces: none (CSS-only). Shared with the web app; additive breakpoint only.

- [ ] **Step 1: Add a single-column stats tier**

In `packages/ui/src/styles/base.css`, immediately after the existing line 671
`@media (max-width: 1100px) { .stats { grid-template-columns: repeat(2, 1fr); } }`, add:

```css
@media (max-width: 760px) { .stats { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Confirm wide tables scroll rather than overflow**

Read `packages/ui/src/styles/base.css` around line 888. Confirm the table scroll container already declares `overflow-x: auto`. If — and only if — no ancestor of `.table` provides horizontal scroll, add it to the existing table wrapper rule (do not create a new selector); otherwise make no change. Record which case applied in the commit body.

- [ ] **Step 3: Manual verification**

Run `npm run dev` in `apps/desktop`. Narrow the window toward the 900px minimum and open the Dashboard.
Verify:
1. Below ~1100px the stat cards drop from 4→2 columns; below ~760px they stack to 1 column.
2. Wide tables (e.g. Work Items) scroll horizontally within their pane instead of forcing the whole view to scroll.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles/base.css
git commit -m "feat(ui): stack stats grid to one column on narrow widths"
```

---

### Task 5: Viewport-aware modal widths

**Files:**
- Modify: `apps/desktop/src/main.jsx` (`CreateWorkItemModal` inner panel `width: 480` ~482; `DesktopProjectAreasModal` inner panel `width: 520` ~797)

**Interfaces:**
- Consumes/Produces: none (style-only change).

- [ ] **Step 1: Make the Create Work Item modal fit narrow windows**

In `apps/desktop/src/main.jsx`, in `CreateWorkItemModal`'s inner panel style (~line 482), change the fixed width to a viewport-aware value:

```js
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 'min(480px, 92vw)',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
```

- [ ] **Step 2: Do the same for the Project Areas modal**

In `DesktopProjectAreasModal`'s inner panel style (~line 797), change `width: 520` to `width: 'min(520px, 92vw)'`:

```js
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 'min(520px, 92vw)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
```

- [ ] **Step 3: Run the desktop test suite to confirm no regression**

Run (from `apps/desktop`): `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run `npm run dev` in `apps/desktop`. Shrink the window to the 900px minimum, then open Create Work Item and Project Areas.
Expected: both modals fit fully within the window with margin on each side (no clipping/horizontal overflow).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): make modal widths fit narrow windows"
```

---

## Notes for the implementer

- Zoom interacts with the reflow breakpoints for free: Electron zoom shrinks the *logical* CSS viewport, so zooming in on a fixed window can itself trigger the sidebar collapse and the stats-grid reflow. This is expected and desirable.
- Do not add a Settings "UI scale" dropdown — native zoom only was the chosen scope.
- Do not persist window bounds — out of scope.
