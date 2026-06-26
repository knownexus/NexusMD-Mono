# Mobile & Tablet Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Helm work great on Samsung Galaxy Tab S7 portrait (800dp) and Android phones (≤600dp) — fixing touch targets, modals that overflow, and adding a configurable navigation system.

**Architecture:** All changes are CSS-first where possible. React changes are limited to: making `Drawer` responsive, adding a bottom nav bar component, and extending the tweaks panel. No new data fetching or ADO changes.

**Tech Stack:** React 18 (window globals via Vite side-effect imports), plain CSS custom properties in `public/css/helm.css`, Capacitor Android.

---

## File Map

| File | What changes |
|------|-------------|
| `public/css/helm.css` | Touch targets, nav width vars, bottom bar layout, drawer/modal phone variants |
| `src/components.jsx` | `Drawer` becomes responsive; add `BottomSheet` component |
| `src/app.jsx` | `NavBottomBar` component; `App()` shell conditionally renders bottom bar; `DEFAULT_TWEAKS` auto-detect; Tweaks panel adds `bottom` option |
| `src/views/view-workitems.jsx` | `FilterDropdown` button height → 44px |
| `src/planner/view-planner-2.jsx` | Phone single-day column layout |

---

## Task 1: CSS Foundation — Touch Targets, Variables, Layout Modes

**Files:**
- Modify: `public/css/helm.css` (lines 40–57 for tokens, append new rules at end)

- [ ] **Step 1: Update density tokens and add new nav/layout vars**

In `public/css/helm.css`, find the `:root` block (around line 40) and update these lines:

```css
  --row-h: 44px;          /* was 38px — minimum touch target height */
  --side-w: 130px;        /* was 232px — label sidebar width */
  --side-w-icons: 56px;   /* icon rail width */
  --bottom-bar-h: 52px;   /* bottom tab bar height */
```

Then in `src/app.jsx`, find the `sidebarWidth` useState (around line 1293):

```js
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = localStorage.getItem('helm-sidebar-w');
      return v ? Math.max(160, Math.min(700, parseInt(v, 10))) : 232;
    } catch { return 232; }
  });
```

Change the default from `232` to `130` and clamp the stored max to 200 so existing wide sidebars shrink:

```js
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = localStorage.getItem('helm-sidebar-w');
      return v ? Math.max(130, Math.min(200, parseInt(v, 10))) : 130;
    } catch { return 130; }
  });
```

- [ ] **Step 2: Add global touch-target rules**

Append to `public/css/helm.css` (after the last existing rule):

```css
/* ── Touch Targets (Android) ─────────────────────────────────────── */
.btn { min-height: 44px; }
.btn.sm { min-height: 36px; }        /* small buttons keep compact height */
.btn.icon { min-height: 44px; min-width: 44px; }
.nav-item { min-height: 44px; }
.nav-section-label { min-height: 32px; }

/* Filter/sort bar buttons in view headers */
button[style*="height: 30"] { min-height: 44px !important; }
```

- [ ] **Step 3: Add bottom nav layout CSS**

Append to `public/css/helm.css`:

```css
/* ── Bottom Nav Layout ───────────────────────────────────────────── */
.bottom-bar {
  display: none;   /* hidden unless data-sidebar="bottom" */
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: var(--bottom-bar-h);
  background: var(--surface);
  border-top: 1px solid var(--border);
  z-index: 100;
  align-items: stretch;
}

.app[data-sidebar="bottom"] .sidebar { display: none; }
.app[data-sidebar="bottom"] .main { margin-left: 0 !important; }
.app[data-sidebar="bottom"] .bottom-bar { display: flex; }
.app[data-sidebar="bottom"] .page { padding-bottom: var(--bottom-bar-h); }

.bottom-bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--text-subtle);
  font-size: 9px;
  font-family: var(--sans);
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  min-height: 52px;
  position: relative;
}
.bottom-bar-item.active { color: var(--accent); }
.bottom-bar-item svg { width: 20px; height: 20px; }

.bottom-bar-badge {
  position: absolute;
  top: 6px; right: calc(50% - 18px);
  background: var(--danger);
  color: white;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  font-family: var(--mono);
}
```

- [ ] **Step 4: Add phone Drawer → bottom sheet CSS**

Append to `public/css/helm.css`:

```css
/* ── Drawer: bottom sheet on phone ──────────────────────────────── */
@media (max-width: 600px) {
  .drawer {
    top: auto !important;
    bottom: 0;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    height: 88vh;
    border-radius: 12px 12px 0 0;
    transform: translateY(100%);
  }
  .drawer.open {
    transform: translateY(0);
  }
  .drawer-resize-handle { display: none; }
  .drawer-head { border-radius: 12px 12px 0 0; }

  /* Drag handle pill */
  .drawer-head::before {
    content: '';
    display: block;
    width: 36px;
    height: 3px;
    background: var(--border-strong);
    border-radius: 2px;
    margin: 0 auto 10px;
  }
}
```

- [ ] **Step 5: Add phone modal → bottom sheet CSS**

Append to `public/css/helm.css`:

```css
/* ── Modals: bottom sheet on phone ─────────────────────────────── */
@media (max-width: 600px) {
  #modal-settings,
  #modal-create-workitem {
    align-items: flex-end !important;
    padding: 0 !important;
  }
  #modal-settings > div,
  #modal-create-workitem > div {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 92vh !important;
    border-radius: 12px 12px 0 0 !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
  }

  /* Collapse the two-column settings layout to single column on phone */
  #modal-settings [style*="grid-template-columns: 1fr 1fr"] {
    grid-template-columns: 1fr !important;
  }
}
```

- [ ] **Step 6: Run dev server and verify in browser at 390px width**

```bash
npm run dev
```

Open http://localhost:5173 in Chrome DevTools, set device to 390×844 (iPhone 14 equivalent). Verify `.btn` elements have increased height and the page renders without horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add public/css/helm.css
git commit -m "feat(mobile): CSS foundation — touch targets, bottom nav, responsive modals/drawer"
```

---

## Task 2: Drawer Responsive — Width Override on Phone

**Files:**
- Modify: `src/components.jsx` (line 182 — `Drawer` function)

The `Drawer` component sets `style={{ width: drawerWidth }}` inline, which overrides the CSS media query. On phone it should ignore the stored width.

- [ ] **Step 1: Add phone detection inside Drawer**

In `src/components.jsx`, modify `function Drawer` (line 182). After the `drawerWidth` state declaration (around line 190), add:

```js
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width:600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const handler = (e) => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
```

- [ ] **Step 2: Conditionally apply width style**

In the same `Drawer` function, change the `<div className={\`drawer ...\`}` line (around line 228) from:

```jsx
      <div className={`drawer ${open ? 'open' : ''}`} ref={drawerRef} style={{ width: drawerWidth }}>
```

to:

```jsx
      <div className={`drawer ${open ? 'open' : ''}`} ref={drawerRef} style={isPhone ? undefined : { width: drawerWidth }}>
```

- [ ] **Step 3: Verify at 390px**

In the dev server (still running from Task 1), open DevTools at 390px width. Click a work item to open its detail. It should slide up from the bottom as a sheet rather than sliding in from the right.

- [ ] **Step 4: Commit**

```bash
git add src/components.jsx
git commit -m "feat(mobile): Drawer becomes bottom sheet on phone (≤600px)"
```

---

## Task 3: Bottom Nav Bar Component

**Files:**
- Modify: `src/app.jsx` (before `function App()`, approximately line 1243)

- [ ] **Step 1: Add `NavBottomBar` component**

In `src/app.jsx`, directly before `function App()` (around line 1243), insert:

```jsx
// Bottom tab bar — rendered when tweaks.sidebar === 'bottom'
const NAV_BOTTOM_PRIMARY = ['dashboard', 'work', 'planner', 'pr'];
const NAV_BOTTOM_MORE = ['builds', 'tests', 'triage', 'team', 'calendar', 'markdown'];

function NavBottomBar({ items, activeId, onNavigate, counts, changeBadges }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const allItems = [...NAV_PRIMARY, ...NAV_SECONDARY];
  const primaryItems = allItems.filter(n => NAV_BOTTOM_PRIMARY.includes(n.id));
  const moreItems    = allItems.filter(n => NAV_BOTTOM_MORE.includes(n.id));
  const moreActive   = moreItems.some(n => n.id === activeId);

  return (
    <>
      {/* More sheet overlay */}
      {moreOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 150,
          background: 'rgba(0,0,0,0.4)',
        }} onClick={() => setMoreOpen(false)}>
          <div style={{
            position: 'absolute', bottom: 'var(--bottom-bar-h)',
            left: 0, right: 0,
            background: 'var(--surface)',
            borderRadius: '12px 12px 0 0',
            padding: '16px 8px 8px',
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 36, height: 3, background: 'var(--border-strong)',
              borderRadius: 2, margin: '0 auto 16px',
            }}/>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {moreItems.map(n => (
                <button key={n.id} className={`bottom-bar-item${n.id === activeId ? ' active' : ''}`}
                  style={{ fontSize: 11, minHeight: 56, borderRadius: 8, background: n.id === activeId ? 'var(--accent-soft)' : 'transparent' }}
                  onClick={() => { onNavigate(n.id); setMoreOpen(false); }}>
                  <Icon name={n.icon} size={20}/>
                  <span>{n.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="bottom-bar">
        {primaryItems.map(n => {
          const badge = changeBadges?.[n.id] || 0;
          return (
            <button key={n.id} className={`bottom-bar-item${n.id === activeId ? ' active' : ''}`}
              onClick={() => onNavigate(n.id)}>
              <Icon name={n.icon} size={20}/>
              <span>{n.label}</span>
              {badge > 0 && <span className="bottom-bar-badge">{badge > 9 ? '9+' : badge}</span>}
            </button>
          );
        })}
        <button className={`bottom-bar-item${moreActive ? ' active' : ''}`}
          onClick={() => setMoreOpen(v => !v)}>
          <Icon name="more-horizontal" size={20}/>
          <span>More</span>
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add `NavBottomBar` into the `App()` render**

In `src/app.jsx`, find the `return (` inside `App()` (around line 1738). The outer `<div ref={appRef} className="app" ...>` already has `data-sidebar={tweaks.sidebar}`. Inside that div, after the closing `</div>` of `{/* ── Main ── */}` (around line 1885) but before the `{/* Detail drawer */}` line, add:

```jsx
      {/* ── Bottom Nav ── */}
      {tweaks.sidebar === 'bottom' && (
        <NavBottomBar
          items={[...NAV_PRIMARY, ...NAV_SECONDARY]}
          activeId={view}
          onNavigate={navigate}
          counts={counts}
          changeBadges={changeBadges}
        />
      )}
```

- [ ] **Step 3: Verify bottom nav renders**

In the dev server with DevTools open at 800px width:
1. Open the Tweaks panel (the gear/display button)
2. Set Sidebar → Icons to confirm the existing modes still work
3. We'll add the `bottom` option in Task 4 — for now just confirm the component renders without JS errors when you temporarily hardcode `tweaks.sidebar = 'bottom'` by editing `DEFAULT_TWEAKS` to `"sidebar": "bottom"` in `src/app.jsx` line ~35

Expected: A 52px tab bar appears at the bottom showing Dashboard, Work items, Planner, PRs, More. The sidebar disappears.

Revert the hardcoded change after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/app.jsx
git commit -m "feat(mobile): add NavBottomBar component for bottom tab navigation"
```

---

## Task 4: Tweaks Panel — Add `bottom` Option + Auto-Default

**Files:**
- Modify: `src/app.jsx` (two locations: `DEFAULT_TWEAKS` at line ~31, TweaksPanel at line ~1897)

- [ ] **Step 1: Add auto-detect helper**

In `src/app.jsx`, directly after the `DEFAULT_TWEAKS` declaration (after the `};` at line ~46), add:

```js
function detectDefaultSidebar() {
  try {
    const stored = JSON.parse(localStorage.getItem('helm.tweaks') || '{}');
    if (stored.sidebar) return stored.sidebar;   // user has already chosen
  } catch (_) {}
  return window.matchMedia('(max-width:600px)').matches ? 'bottom' : 'labels';
}
```

- [ ] **Step 2: Update `DEFAULT_TWEAKS` sidebar value**

In `src/app.jsx`, find `DEFAULT_TWEAKS` (around line 31). Change:

```js
  "sidebar": "labels",
```

to:

```js
  "sidebar": "labels",  // runtime default is overridden by detectDefaultSidebar()
```

Then in `function App()` (around line 1244), find where `storedTweaks` is built:

```js
  const storedTweaks = (() => {
    try { const s = localStorage.getItem('helm.tweaks'); return s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS; } catch { return DEFAULT_TWEAKS; }
  })();
```

Change to:

```js
  const storedTweaks = (() => {
    try {
      const s = localStorage.getItem('helm.tweaks');
      const parsed = s ? JSON.parse(s) : {};
      return { ...DEFAULT_TWEAKS, sidebar: detectDefaultSidebar(), ...parsed };
    } catch { return { ...DEFAULT_TWEAKS, sidebar: detectDefaultSidebar() }; }
  })();
```

- [ ] **Step 3: Add `bottom` to the Tweaks panel radio**

In `src/app.jsx`, find the TweaksPanel section (around line 1897):

```jsx
          <TweakRadio label="Sidebar" value={tweaks.sidebar} onChange={v=>setTweak('sidebar',v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
```

Change to:

```jsx
          <TweakRadio label="Nav" value={tweaks.sidebar} onChange={v=>setTweak('sidebar',v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'},{label:'Bottom',value:'bottom'}]}/>
```

- [ ] **Step 4: Verify all three nav modes**

In the dev server at 800px width:
1. Open the Tweaks panel → Nav → select "Bottom" → bottom tab bar appears, sidebar hidden
2. Select "Icons" → icon rail appears
3. Select "Labels" → 130px label sidebar appears

At 390px width with no stored preference, clear localStorage and reload — should default to "Bottom".

- [ ] **Step 5: Commit**

```bash
git add src/app.jsx
git commit -m "feat(mobile): nav style tweaks — add 'bottom' option, auto-detect default from screen size"
```

---

## Task 5: FilterDropdown Touch Targets in Work Items

**Files:**
- Modify: `src/views/view-workitems.jsx` (line 29 — the filter button style)

The `FilterDropdown` button at line 29 has `height: 30`. Any inline height under 44 needs to change.

- [ ] **Step 1: Fix FilterDropdown button height**

In `src/views/view-workitems.jsx`, find the button style inside `FilterDropdown` (around line 22–42). Change:

```js
                    height: 30,
```

to:

```js
                    height: 44,
```

- [ ] **Step 2: Scan for other small fixed heights in this file**

Search for `height: 3` (matches 30, 32, 36, 38) in `src/views/view-workitems.jsx`:

```bash
grep -n "height: 3[0-8]" src/views/view-workitems.jsx
```

For each match that is a tappable button or row, change to `minHeight: 44` (don't change decorative elements like separators or icon sizes).

- [ ] **Step 3: Verify in browser**

In the dev server at 390px width, navigate to Work Items. Tap the filter buttons — they should be easily tappable without mis-taps.

- [ ] **Step 4: Commit**

```bash
git add src/views/view-workitems.jsx
git commit -m "fix(mobile): increase FilterDropdown touch targets to 44px min-height"
```

---

## Task 6: Touch Target Pass — Remaining Views

**Files:**
- Modify: `src/views/view-prs.jsx`, `src/views/view-builds.jsx`, `src/views/view-tests.jsx`, `src/views/view-triage.jsx`

- [ ] **Step 1: Find small heights in each view file**

Run this for each view:

```bash
grep -n "height: [23][0-9]" src/views/view-prs.jsx
grep -n "height: [23][0-9]" src/views/view-builds.jsx
grep -n "height: [23][0-9]" src/views/view-tests.jsx
grep -n "src/views/view-triage.jsx" && grep -n "height: [23][0-9]" src/views/view-triage.jsx
```

- [ ] **Step 2: Fix each tappable element**

For each match that is a button, row, or tab — not a decorative element like a divider, icon, or avatar:
- Change `height: 30` → `minHeight: 44`
- Change `height: 32` → `minHeight: 44`
- Change `height: 36` → `minHeight: 44`
- Change `height: 38` → `minHeight: 44`

Leave `height` values on: `<img>`, icons, separators, `<svg>`, colour swatches, and non-interactive divs.

- [ ] **Step 3: Verify each view at 390px**

In the dev server at 390px width, visit PRs, Builds, Tests, and Triage. Confirm all visible buttons and row items have adequate tap area.

- [ ] **Step 4: Commit**

```bash
git add src/views/view-prs.jsx src/views/view-builds.jsx src/views/view-tests.jsx src/views/view-triage.jsx
git commit -m "fix(mobile): touch target pass on PR, Build, Test, Triage views (44px min-height)"
```

---

## Task 7: Planner — Phone Single-Day Layout

**Files:**
- Modify: `src/planner/view-planner-2.jsx` (the active planner)

Read `src/planner/view-planner-2.jsx` before starting this task to understand the current week-grid layout.

- [ ] **Step 1: Read the planner layout**

```bash
grep -n "day\|week\|column\|grid" src/planner/view-planner-2.jsx | head -40
```

Identify: which component renders the week columns, what prop controls the day range.

- [ ] **Step 2: Add phone detection to the planner**

At the top of the main planner view component in `view-planner-2.jsx`, add:

```js
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width:600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const fn = e => setIsPhone(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
```

- [ ] **Step 3: Add selected-day state**

In the same component, add:

```js
  const [phoneDay, setPhoneDay] = useState(0); // 0 = Monday, 4 = Friday
```

- [ ] **Step 4: Conditionally render single day on phone**

Find where the week columns are rendered (look for a `.map()` over days or a grid with 5 children). Wrap it to filter to a single day on phone:

```js
  const visibleDays = isPhone ? [phoneDay] : [0, 1, 2, 3, 4];
  // then: visibleDays.map(dayIndex => ...)
```

- [ ] **Step 5: Add day nav arrows for phone**

Directly above the week grid render, add phone day navigation:

```jsx
  {isPhone && (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', minHeight: 44 }}>
      <button className="btn icon ghost" disabled={phoneDay === 0} onClick={() => setPhoneDay(d => d - 1)}>
        <Icon name="chevron-left" size={16}/>
      </button>
      <span style={{ fontWeight: 600, fontSize: 14 }}>{['Mon','Tue','Wed','Thu','Fri'][phoneDay]}</span>
      <button className="btn icon ghost" disabled={phoneDay === 4} onClick={() => setPhoneDay(d => d + 1)}>
        <Icon name="chevron-right" size={16}/>
      </button>
    </div>
  )}
```

- [ ] **Step 6: Verify planner on phone**

In the dev server at 390px width, navigate to Planner. You should see a single day column with Mon/Tue/Wed/Thu/Fri prev/next arrows. On 800px it should show the full 5-day week as before.

- [ ] **Step 7: Commit**

```bash
git add src/planner/view-planner-2.jsx
git commit -m "feat(mobile): planner shows single-day column on phone with prev/next day nav"
```

---

## Task 8: End-to-End Verification on Device

- [ ] **Step 1: Build and sync to Android**

```bash
npm run android
```

This runs `vite build && cap sync && cap open android`.

- [ ] **Step 2: Run on Samsung SM-T870 in Android Studio**

In Android Studio, select the SM-T870 device (portrait orientation) and click Run.

- [ ] **Step 3: Verify checklist on tablet (800dp portrait)**

Check each item on the physical device:
- [ ] Label sidebar is 130px wide, all nav items are min 44px tall
- [ ] Tapping a work item opens a right-side drawer (not bottom sheet)
- [ ] Settings modal is a centred dialog (not full-screen)
- [ ] Dashboard widget grab handles are easily tappable
- [ ] Tweaks panel → Nav → switching between Labels / Icons / Bottom works
- [ ] Bottom tab bar shows Dashboard, Work items, Planner, PRs, More
- [ ] "More" opens a sheet with remaining nav items
- [ ] Planner shows 5-day week view
- [ ] Filter buttons in Work Items are 44px tall

- [ ] **Step 4: Verify checklist on phone (if available, or use Android emulator at 390dp)**

- [ ] Work item detail opens as a bottom sheet (slides up, swipe handle visible)
- [ ] Settings modal slides up from bottom
- [ ] Create work item modal slides up from bottom
- [ ] Nav defaults to "Bottom" tab bar on first launch (clear app data to test)
- [ ] Planner shows single-day with Mon/Tue/Wed/Thu/Fri arrows
- [ ] All buttons and rows tappable without mis-taps

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(mobile): device verification fixes"
```
