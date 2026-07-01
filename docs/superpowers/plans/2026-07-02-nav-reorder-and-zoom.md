# Nav Reordering + Zoom Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reorder the desktop nav sidebar from Settings and set a whole-app zoom level from the Appearance settings.

**Architecture:** A pure `orderedNav()` helper drives sidebar order from a new `navOrder` tweak (localStorage). A `NavOrderEditor` component (drag-to-reorder, reusing the dashboard widget DnD pattern) edits it. Zoom reuses the existing Electron zoom engine (`electron/zoom.cjs` + `applyZoom`) exposed to the renderer via new IPC, driven by a `ZoomSlider` component that keeps zoom as a native window pref (not a tweak).

**Tech Stack:** React 18, Vitest 4 + @testing-library/react (jsdom), Electron (contextBridge IPC).

## Global Constraints

- Zoom clamp: `ZOOM_MIN=0.5`, `ZOOM_MAX=2.0`, `ZOOM_DEFAULT=1.0` (from `apps/desktop/electron/zoom.cjs`) — the slider maps 50–200% onto this range; never widen it.
- Zoom is a native window pref persisted as `prefs.zoomFactor` in the Electron main process — do NOT store zoom in `nexusmd.tweaks` localStorage.
- Nav order persists via the existing `nexusmd.tweaks` localStorage blob through `setTweak('navOrder', …)`.
- Renderer code that calls zoom IPC must guard on `window.electronAPI` presence (absent in web build / tests).
- Test command (run from `apps/desktop`): `npx vitest run <path>`.
- Follow existing file conventions: 2-space indent, single quotes, no semicolons in `src/*.jsx`; semicolons + single quotes in `electron/*.cjs`.

---

### Task 1: `orderedNav` helper

**Files:**
- Modify: `apps/desktop/src/layout.js`
- Test: `apps/desktop/src/layout.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `orderedNav(navOrder: string[] | undefined, nav: {id: string}[]) => {id: string}[]` — returns `nav` items ordered by `navOrder`, appending any `nav` items whose id is absent from `navOrder`, dropping ids in `navOrder` not present in `nav`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/layout.test.js`:

```javascript
import { effectiveSidebar, SIDEBAR_BREAKPOINT, orderedNav } from './layout.js'

describe('orderedNav', () => {
  const NAV = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('orders items by navOrder', () => {
    expect(orderedNav(['c', 'a', 'b'], NAV).map(i => i.id)).toEqual(['c', 'a', 'b'])
  })
  it('appends nav items missing from a stored order', () => {
    expect(orderedNav(['b'], NAV).map(i => i.id)).toEqual(['b', 'a', 'c'])
  })
  it('drops stale ids not present in nav', () => {
    expect(orderedNav(['gone', 'a', 'b', 'c'], NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('falls back to full nav order when navOrder is missing', () => {
    expect(orderedNav(undefined, NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
    expect(orderedNav([], NAV).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})
```

Update the existing top import line in the file from `import { effectiveSidebar, SIDEBAR_BREAKPOINT } from './layout.js'` — the block above already includes the merged import, so delete the old duplicate import line if the test runner complains about a redeclare (there must be exactly one import from `./layout.js`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/layout.test.js`
Expected: FAIL — `orderedNav is not a function` (or export missing).

- [ ] **Step 3: Implement `orderedNav`**

Append to `apps/desktop/src/layout.js`:

```javascript
// Resolve the sidebar's nav order from a stored id list, tolerating drift:
// items are returned in navOrder sequence, any nav items missing from the
// stored order are appended (so newly added nav entries still appear), and
// stored ids no longer in nav are dropped. Pure, for unit testing.
export function orderedNav(navOrder, nav) {
  const order = Array.isArray(navOrder) ? navOrder : []
  const byId = new Map(nav.map(item => [item.id, item]))
  const ordered = order.map(id => byId.get(id)).filter(Boolean)
  const seen = new Set(ordered.map(item => item.id))
  const rest = nav.filter(item => !seen.has(item.id))
  return [...ordered, ...rest]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/layout.test.js`
Expected: PASS (all `effectiveSidebar` and `orderedNav` cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/layout.js apps/desktop/src/layout.test.js
git commit -m "feat(desktop): add orderedNav helper for sidebar reordering"
```

---

### Task 2: `NavOrderEditor` component

**Files:**
- Create: `apps/desktop/src/nav-order-editor.jsx`
- Test: `apps/desktop/src/nav-order-editor.test.jsx`

**Interfaces:**
- Consumes: `orderedNav` from `./layout.js` (Task 1).
- Produces: `NavOrderEditor({ nav: {id, label, icon}[], order: string[], onChange: (ids: string[]) => void })` — renders a draggable list of nav labels in resolved order; on drop, calls `onChange` with the new id array.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/nav-order-editor.test.jsx`:

```javascript
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NavOrderEditor } from './nav-order-editor.jsx'

afterEach(cleanup)

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'calendar', label: 'Calendar', icon: 'clock' },
  { id: 'work', label: 'Work Items', icon: 'work' },
]

function makeDataTransfer() {
  return { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
}

describe('NavOrderEditor', () => {
  it('renders items in resolved order', () => {
    render(<NavOrderEditor nav={NAV} order={['work', 'dashboard', 'calendar']} onChange={vi.fn()} />)
    const items = screen.getAllByTestId('nav-order-item').map(el => el.textContent)
    expect(items).toEqual(['Work Items', 'Dashboard', 'Calendar'])
  })

  it('reorders on drop and calls onChange with new id order', () => {
    const onChange = vi.fn()
    render(<NavOrderEditor nav={NAV} order={['dashboard', 'calendar', 'work']} onChange={onChange} />)
    const rows = screen.getAllByTestId('nav-order-item')
    const dt = makeDataTransfer()
    // drag 'work' (index 2) onto 'dashboard' (index 0)
    fireEvent.dragStart(rows[2], { dataTransfer: dt })
    fireEvent.dragOver(rows[0], { dataTransfer: dt })
    fireEvent.drop(rows[0], { dataTransfer: dt })
    expect(onChange).toHaveBeenCalledWith(['work', 'dashboard', 'calendar'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/nav-order-editor.test.jsx`
Expected: FAIL — cannot resolve `./nav-order-editor.jsx`.

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/nav-order-editor.jsx`:

```jsx
import React from 'react'
import { orderedNav } from './layout.js'

// Drag-to-reorder list of nav items, editing the persisted navOrder from
// Settings. Mirrors the dashboard widget DnD pattern (view-dashboard.jsx):
// HTML5 draggable rows, reorder on drop, report the new id array upward.
export function NavOrderEditor({ nav, order, onChange }) {
  const items = orderedNav(order, nav)
  const ids = items.map(item => item.id)
  const [dragId, setDragId] = React.useState(null)

  const onDragStart = id => e => { setDragId(id); e.dataTransfer.effectAllowed = 'move' }
  const onDragOver = () => e => { e.preventDefault() }
  const onDrop = id => e => {
    e.preventDefault()
    if (!dragId || dragId === id) { setDragId(null); return }
    const next = ids.slice()
    const from = next.indexOf(dragId)
    const to = next.indexOf(id)
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    onChange(next)
    setDragId(null)
  }

  return (
    <div className="nav-order-editor" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map(item => (
        <div
          key={item.id}
          data-testid="nav-order-item"
          draggable
          onDragStart={onDragStart(item.id)}
          onDragOver={onDragOver()}
          onDrop={onDrop(item.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 8px', borderRadius: 6, cursor: 'grab',
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            fontSize: 13, opacity: dragId === item.id ? 0.5 : 1,
          }}
        >
          <span aria-hidden="true" style={{ color: 'var(--text-subtle)', cursor: 'grab' }}>⋮⋮</span>
          {item.label}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/nav-order-editor.test.jsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/nav-order-editor.jsx apps/desktop/src/nav-order-editor.test.jsx
git commit -m "feat(desktop): add NavOrderEditor drag-to-reorder component"
```

---

### Task 3: Wire nav reorder into the app

**Files:**
- Modify: `apps/desktop/src/main.jsx` (imports ~line 15–17; `DEFAULT_TWEAKS` ~line 76–85; sidebar render ~line 843; Appearance section ~line 962–974)

**Interfaces:**
- Consumes: `orderedNav` (Task 1), `NavOrderEditor` (Task 2), existing `NAV`, `tweaks`, `setTweak`, `TweakButton`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the helper and component**

In `apps/desktop/src/main.jsx`, update the `./layout.js` import (currently line 17) to add `orderedNav`:

```javascript
import { effectiveSidebar, ICON_RAIL_WIDTH, orderedNav } from './layout.js'
```

Add a new import below it:

```javascript
import { NavOrderEditor } from './nav-order-editor.jsx'
```

- [ ] **Step 2: Add `navOrder` default**

In `DEFAULT_TWEAKS` (line 76–85), add a `navOrder` field derived from `NAV`. Because `NAV` is declared later (line 199), define the default as a literal id list matching `NAV` order. Add this line inside `DEFAULT_TWEAKS` after `widgetOrder`:

```javascript
  navOrder: ['dashboard', 'calendar', 'work', 'prs', 'builds', 'tests', 'team', 'triage', 'planner', 'markdown', 'settings'],
```

- [ ] **Step 3: Render the sidebar in resolved order**

In the sidebar render (line 843), change:

```jsx
          {NAV.map((item, idx) => (
```

to:

```jsx
          {orderedNav(tweaks.navOrder, NAV).map((item, idx) => (
```

- [ ] **Step 4: Add the editor + reset button to Appearance**

In the Appearance `TweakSection` (after the "Show type labels" `TweakToggle` at line 972–973, before `</TweakSection>` at line 974), add:

```jsx
          <NavOrderEditor nav={NAV} order={tweaks.navOrder}
            onChange={ids => setTweak('navOrder', ids)} />
          <TweakButton label="Reset nav order"
            onClick={() => setTweak('navOrder', DEFAULT_TWEAKS.navOrder)} />
```

- [ ] **Step 5: Verify the full suite still passes**

Run: `npx vitest run`
Expected: PASS — no regressions. (No new unit test here; nav logic is covered by Tasks 1–2.)

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev` (in `apps/desktop`), open Settings → Display → Appearance, drag a nav item in the editor, confirm the sidebar reorders and the order survives a reload. Click "Reset nav order" and confirm the sidebar returns to default.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): reorder nav sidebar from Appearance settings"
```

---

### Task 4: Zoom IPC bridge (main + preload)

**Files:**
- Modify: `apps/desktop/electron/main.cjs` (`applyZoom` ~line 159–164; add handlers near the other `ipcMain.handle` calls ~line 356–360)
- Modify: `apps/desktop/electron/preload.cjs` (add to the `electronAPI` object, e.g. after `onDeepLink` ~line 67)

**Interfaces:**
- Consumes: existing `applyZoom(win, factor)`, `clampZoomFactor`, `ZOOM_DEFAULT`, module-level `mainWindow`, `prefs`.
- Produces (on `window.electronAPI`):
  - `getZoomFactor() => Promise<number>` — current zoom factor (0.5–2.0).
  - `setZoomFactor(factor: number) => Promise<void>` — clamp, apply, persist.
  - `onZoomChanged(cb: (factor: number) => void) => () => void` — subscribe; returns unsubscribe.

- [ ] **Step 1: Emit an event from `applyZoom`**

In `apps/desktop/electron/main.cjs`, update `applyZoom` (line 159–164) to notify the renderer after applying:

```javascript
// Apply and persist a zoom factor for the given window.
function applyZoom(win, factor) {
  const f = clampZoomFactor(factor)
  win.webContents.setZoomFactor(f)
  prefs.zoomFactor = f
  try { savePrefs(prefs) } catch { /* best-effort */ }
  try { win.webContents.send('zoom:changed', f) } catch { /* best-effort */ }
}
```

- [ ] **Step 2: Add the IPC handlers**

In `apps/desktop/electron/main.cjs`, after the `set-close-to-tray` handler (line 360), add:

```javascript
// ---------------------------------------------------------------------------
// Zoom IPC — lets the Appearance settings slider drive the native zoom engine
// ---------------------------------------------------------------------------
ipcMain.handle('get-zoom-factor', () => clampZoomFactor(prefs.zoomFactor ?? ZOOM_DEFAULT));
ipcMain.handle('set-zoom-factor', (_e, factor) => {
  if (mainWindow && !mainWindow.isDestroyed()) applyZoom(mainWindow, factor);
});
```

- [ ] **Step 3: Expose the API in preload**

In `apps/desktop/electron/preload.cjs`, add to the `electronAPI` object (after `onDeepLink`, line 67):

```javascript
  // ── Zoom IPC ────────────────────────────────────────────────────────────────
  // Drive the native whole-app zoom engine from the Appearance settings slider.
  getZoomFactor: () => ipcRenderer.invoke('get-zoom-factor'),
  setZoomFactor: (factor) => ipcRenderer.invoke('set-zoom-factor', factor),
  onZoomChanged: (cb) => {
    const handler = (_e, factor) => cb(factor);
    ipcRenderer.on('zoom:changed', handler);
    return () => ipcRenderer.removeListener('zoom:changed', handler);
  },
```

- [ ] **Step 4: Verify the existing zoom unit tests still pass**

Run: `npx vitest run electron/zoom.test.js`
Expected: PASS — `applyZoom` change does not touch `zoom.cjs`; no regression.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`. In DevTools console, run `await window.electronAPI.getZoomFactor()` (expect a number), then `await window.electronAPI.setZoomFactor(1.5)` and confirm the UI scales up. Press Ctrl+0 and confirm a `zoom:changed` event fires (temporarily `window.electronAPI.onZoomChanged(f => console.log('zoom', f))`).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs
git commit -m "feat(desktop): expose zoom factor over IPC for settings control"
```

---

### Task 5: `ZoomSlider` component

**Files:**
- Create: `apps/desktop/src/zoom-slider.jsx`
- Test: `apps/desktop/src/zoom-slider.test.jsx`

**Interfaces:**
- Consumes: `TweakSlider` from `@nexusmd/ui`; `window.electronAPI.{getZoomFactor,setZoomFactor,onZoomChanged}` (Task 4).
- Produces: `ZoomSlider()` — renders nothing when `window.electronAPI` is absent; otherwise a `TweakSlider` (50–200%, step 10) reflecting/driving the native zoom factor.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/zoom-slider.test.jsx`:

```javascript
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/ui', () => ({
  TweakSlider: ({ label, value, min, max, step, unit, onChange }) => (
    <div data-testid="zoom-tweakslider">
      <span>{label}</span>
      <span data-testid="zoom-value">{value}{unit}</span>
      <input type="range" aria-label={label} min={min} max={max} step={step}
             value={value} onChange={e => onChange(Number(e.target.value))} />
    </div>
  ),
}))

import { ZoomSlider } from './zoom-slider.jsx'

afterEach(() => { cleanup(); delete window.electronAPI })

describe('ZoomSlider', () => {
  it('renders nothing without electronAPI', () => {
    const { container } = render(<ZoomSlider />)
    expect(container).toBeEmptyDOMElement()
  })

  it('initializes from getZoomFactor as a percentage', async () => {
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.5),
      setZoomFactor: vi.fn(),
      onZoomChanged: vi.fn(() => () => {}),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('150%'))
  })

  it('writes back the factor when the slider changes', async () => {
    const setZoomFactor = vi.fn()
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.0),
      setZoomFactor,
      onZoomChanged: vi.fn(() => () => {}),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('100%'))
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '130' } })
    expect(setZoomFactor).toHaveBeenCalledWith(1.3)
  })

  it('updates when onZoomChanged fires', async () => {
    let cbRef
    window.electronAPI = {
      getZoomFactor: vi.fn().mockResolvedValue(1.0),
      setZoomFactor: vi.fn(),
      onZoomChanged: vi.fn(cb => { cbRef = cb; return () => {} }),
    }
    render(<ZoomSlider />)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('100%'))
    cbRef(0.8)
    await waitFor(() => expect(screen.getByTestId('zoom-value').textContent).toBe('80%'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/zoom-slider.test.jsx`
Expected: FAIL — cannot resolve `./zoom-slider.jsx`.

- [ ] **Step 3: Implement the component**

Create `apps/desktop/src/zoom-slider.jsx`:

```jsx
import React from 'react'
import { TweakSlider } from '@nexusmd/ui'

// Appearance-settings control for the native whole-app zoom. Zoom is owned by
// the Electron main process (persisted as prefs.zoomFactor), so this holds the
// value in local state — initialized from getZoomFactor, synced via
// onZoomChanged (menu / Ctrl± / wheel), and written back with setZoomFactor.
// Renders nothing outside Electron (web build / tests without electronAPI).
export function ZoomSlider() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const [percent, setPercent] = React.useState(100)

  React.useEffect(() => {
    if (!api) return undefined
    let active = true
    Promise.resolve(api.getZoomFactor()).then(f => {
      if (active && typeof f === 'number') setPercent(Math.round(f * 100))
    })
    const off = api.onZoomChanged(f => {
      if (typeof f === 'number') setPercent(Math.round(f * 100))
    })
    return () => { active = false; if (typeof off === 'function') off() }
  }, [api])

  if (!api) return null

  const onChange = p => {
    setPercent(p)
    api.setZoomFactor(p / 100)
  }

  return (
    <TweakSlider label="Zoom" value={percent} min={50} max={200} step={10}
      unit="%" onChange={onChange} />
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/zoom-slider.test.jsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/zoom-slider.jsx apps/desktop/src/zoom-slider.test.jsx
git commit -m "feat(desktop): add ZoomSlider settings control"
```

---

### Task 6: Wire `ZoomSlider` into the Appearance section

**Files:**
- Modify: `apps/desktop/src/main.jsx` (imports; Appearance section ~line 962–974)

**Interfaces:**
- Consumes: `ZoomSlider` (Task 5).
- Produces: nothing.

- [ ] **Step 1: Import `ZoomSlider`**

In `apps/desktop/src/main.jsx`, add near the other local imports (e.g. below the `NavOrderEditor` import added in Task 3):

```javascript
import { ZoomSlider } from './zoom-slider.jsx'
```

- [ ] **Step 2: Render it in the Appearance section**

In the Appearance `TweakSection`, after the `TweakRadio label="Sidebar"` block (line 969–971) and before "Show type labels", add:

```jsx
          <ZoomSlider />
```

- [ ] **Step 3: Verify the full suite passes**

Run: `npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`. Settings → Display → Appearance: confirm a "Zoom" slider appears, dragging it scales the whole app, Ctrl+= / Ctrl+- move the slider in sync, and the level survives a reload.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Zoom control to Appearance settings"
```

---

## Self-Review

**Spec coverage:**
- Nav `navOrder` tweak + persistence → Task 3 Step 2.
- `orderedNav` (order / append / drop) → Task 1.
- `NavOrderEditor` drag list reusing dashboard DnD → Task 2.
- Sidebar renders in resolved order → Task 3 Step 3.
- "Reset nav order" button → Task 3 Step 4.
- Zoom IPC `get`/`set` + `zoom:changed` event → Task 4.
- Preload `getZoomFactor`/`setZoomFactor`/`onZoomChanged` → Task 4 Step 3.
- `TweakSlider` 50–200%, local state, hidden without `electronAPI` → Task 5.
- Zoom stays a native pref (not a tweak) → Task 5 (local state) + Global Constraints.
- Tests: `orderedNav`, zoom conversion, electronAPI-absent render → Tasks 1, 5.

**Placeholder scan:** No TBD/TODO; every code step shows full code.

**Type consistency:** `orderedNav(navOrder, nav)` signature identical across Tasks 1–3. `NavOrderEditor({ nav, order, onChange })` identical Tasks 2–3. `getZoomFactor`/`setZoomFactor`/`onZoomChanged` names identical Tasks 4–5. Slider maps factor↔percent (`*100` / `/100`) consistently in Task 5.
