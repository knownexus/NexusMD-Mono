# Cross-Platform Planner + MarkdownViewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share `PlannerView` into `@nexusmd/ui`, wire both Planner and MarkdownViewer into the Electron desktop, and fix the `meetSched` datetime column discrepancy between platforms.

**Architecture:** Runtime-driven extraction via the existing `plannerRuntime` singleton — `getPlannerRuntime()` provides namespace, pushPref, and storage so the shared component needs zero per-platform props. Each app's `NexusDataProvider` already calls `setPlannerRuntime`; no wiring changes needed at the provider level.

**Tech Stack:** React 18, JSZip, `@nexusmd/core` (PLANNER_SECTIONS, helpers), `@nexusmd/ui` (shared views, planner subsystems)

## Global Constraints

- No localStorage calls — use `rt.storage.getItem/setItem/removeItem` (runtime-seamed)
- All namespace prefixes via `rt.namespace` — never hardcode `nexusmd.` or `helm.`
- All pushPref calls via `rt.pushPref?.()` — never import `helmPushPref` or `nexusMDPushPref`
- FAB + Sheet components: gated on `isPhone === true` only
- `m-screen` wrapper: gated on `isPhone === true` only
- Header class: `page-head` (not `m-appbar`) — the app's CSS handles visual identity
- `window.NexusMDNav` — shared view uses this only; app renames its two write sites in Task 6
- No data migration: existing per-profile localStorage keys stay in their namespace

---

## File Map

| File | Action |
|------|--------|
| `packages/core/src/modules/planner/index.js` | Modify: fix `meetSched.dayTime` col `t:'text'` → `t:'datetime'`, `w:'12%'` → `w:'14%'` |
| `packages/ui/src/app-components.jsx` | Modify: add `Sheet` component |
| `packages/ui/src/index.js` | Modify: export `Sheet`, `PlannerView`, `plannerExportDocx` |
| `packages/ui/package.json` | Modify: add `jszip` dependency |
| `packages/ui/src/planner/docx.js` | Create: shared DOCX generation logic |
| `packages/ui/src/views/view-planner.jsx` | Create: shared `PlannerView` orchestrator |
| `apps/web/src/view-planner.jsx` | Modify: remove local DOCX fn, add `PlannerView`/`plannerExportDocx` re-exports |
| `apps/web/src/view-planner-2.jsx` | Delete |
| `apps/web/src/app.jsx` | Modify: update PlannerView import source (line 23) |
| `apps/app/src/planner/view-planner.jsx` | Modify: remove local PLANNER_SECTIONS/DOCX/helpers, add re-exports |
| `apps/app/src/planner/view-planner-2.jsx` | Delete |
| `apps/app/src/app.jsx` | Modify: rename `window.HelmNav` → `window.NexusMDNav` (×2), add `onExportDocx` prop |
| `apps/app/src/components.jsx` | Modify: remove `Sheet` fn, re-export from `@nexusmd/ui` |
| `apps/desktop/src/main.jsx` | Modify: import `PlannerView`/`MarkdownViewer`, add nav entry + switch cases |

---

### Task 1: Fix `meetSched` datetime col in `@nexusmd/core`

**Files:**
- Modify: `packages/core/src/modules/planner/index.js:91-94`

**Interfaces:**
- Produces: `PLANNER_SECTIONS` where `meetSched.cols[0]` has `t:'datetime', w:'14%'`

- [ ] **Step 1: Edit the col definition**

In `packages/core/src/modules/planner/index.js` around line 92, change:

```js
// Before
{ id:'meetSched', num:'2a', title:'Meetings - schedule', icon:'planner', type:'table', cols:[
  { k:'dayTime', l:'Day / Time', t:'text', w:'12%' }, ...
```

```js
// After
{ id:'meetSched', num:'2a', title:'Meetings - schedule', icon:'planner', type:'table', cols:[
  { k:'dayTime', l:'Day / Time', t:'datetime', w:'14%' }, ...
```

- [ ] **Step 2: Verify no other cols changed**

The full `meetSched` entry after the edit must be:
```js
{ id:'meetSched', num:'2a', title:'Meetings - schedule', icon:'planner', type:'table', cols:[
  { k:'dayTime', l:'Day / Time', t:'datetime', w:'14%' }, { k:'meeting', l:'Meeting', t:'text', w:'20%', main:true }, { k:'attendees', l:'Attendees', t:'text', w:'18%' },
  { k:'prep', l:'Prep needed', t:'text', w:'20%' }, { k:'owner', l:'Owner', t:'text', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
]},
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/modules/planner/index.js
git commit -m "fix(core): meetSched dayTime col t:datetime + w:14% (matches app canonical)"
```

---

### Task 2: Add `Sheet` to `@nexusmd/ui`

**Files:**
- Modify: `packages/ui/src/app-components.jsx`
- Modify: `packages/ui/src/index.js`

**Interfaces:**
- Consumes: `Icon` from `'./icons.jsx'`; `useEffect` from React
- Produces: exported `Sheet` component with props `{ open, onClose, icon, title, sub, children, footer, size }`

- [ ] **Step 1: Append `Sheet` to `packages/ui/src/app-components.jsx`**

Add at the end of the file:

```jsx
// ─── Sheet — mobile bottom sheet ─────────────────────────────────────────────
export function Sheet({ open, onClose, icon, title, sub, children, footer, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const labelId = title ? 'm-sheet-title' : undefined;
  return (
    <div className="m-sheet-veil"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m-sheet" style={size === 'tall' ? { maxHeight: '92%' } : null}
        role="dialog" aria-modal="true" aria-labelledby={labelId}
        onClick={e => e.stopPropagation()}>
        {(title || icon) && (
          <div className="m-sheet-h">
            {icon && (
              <span className="ic">
                <Icon name={icon} size={16}/>
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 id={labelId}>{title}</h2>
              {sub && <div className="sub">{sub}</div>}
            </div>
            <button className="m-iconbtn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={17}/>
            </button>
          </div>
        )}
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export `Sheet` from `packages/ui/src/index.js`**

Find the existing app-components export block (line ~19):
```js
export {
  Avatar, TypeIcon, NotificationBanner, MenuButton, usePersisted, ProjectChip, Drawer,
} from './app-components.jsx'
```

Change to:
```js
export {
  Avatar, TypeIcon, NotificationBanner, MenuButton, usePersisted, ProjectChip, Drawer, Sheet,
} from './app-components.jsx'
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/app-components.jsx packages/ui/src/index.js
git commit -m "feat(ui): add Sheet component to @nexusmd/ui"
```

---

### Task 3: Create shared `plannerExportDocx` in `@nexusmd/ui`

**Files:**
- Create: `packages/ui/src/planner/docx.js`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/index.js`

**Interfaces:**
- Consumes: `PLANNER_SECTIONS` from `@nexusmd/core`; `jszip` npm package; browser `DOMParser`, `XMLSerializer`, `URL.createObjectURL`
- Produces: `plannerExportDocx(data, themes, dateLabel)` — async function, fetches `/templates/Weekly_Planner.docx`, fills it, triggers browser download

- [ ] **Step 1: Add `jszip` to `packages/ui/package.json`**

In the `"dependencies"` section, add `"jszip": "^3.10.1"`:

```json
"dependencies": {
  "@azure/msal-browser": "^3.30.0",
  "@nexusmd/core": "*",
  "dompurify": "^3.2.6",
  "flatpickr": "^4.6.13",
  "jszip": "^3.10.1",
  "marked": "^9.1.6"
},
```

- [ ] **Step 2: Run `npm install` from the repo root to update the lockfile**

```bash
npm install
```

- [ ] **Step 3: Create `packages/ui/src/planner/docx.js`**

```js
import JSZip from 'jszip'
import { PLANNER_SECTIONS } from '@nexusmd/core'

const _W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const DOCX_HEADING_MAP = {
  '1 to do tasks for me':            'tasks',
  'meeting schedule':                'meetSched',
  'meeting notes decisions':         'meetNotes',
  'inbound needs my response':       'chatsIn',
  'outbound chats i need to start':  'chatsOut',
  'status updates to send':          'statusUpdates',
  '4 1 1s':                          'oneOnOnes',
  'themes to watch across the team': 'themes',
  'daily log':                       'dailyLog',
  'action plan per person':          'actionPlan',
  '7 work item creation':            'workItemsPlan',
  '9 tasks for team devs':           'teamTasks',
  '10 reminders':                    'reminders',
  '11 notes parking lot':            'notes',
  '12 end of week review':           'eow',
}

function _getText(el) { return Array.from(el.getElementsByTagName('w:t')).map(t => t.textContent).join('') }
function _norm(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim() }
function _kids(el, tag) { return Array.from(el.childNodes).filter(n => n.tagName === tag) }
function _paraStyle(p) { const s = p.getElementsByTagName('w:pStyle')[0]; return s ? (s.getAttribute('w:val')||'Normal') : 'Normal' }

function _setParaText(xmlDoc, paraEl, text) {
  const pPr = paraEl.getElementsByTagName('w:pPr')[0] || null
  while (paraEl.lastChild) paraEl.removeChild(paraEl.lastChild)
  if (pPr) paraEl.appendChild(pPr)
  if (text) {
    const r = xmlDoc.createElementNS(_W_NS, 'w:r')
    const t = xmlDoc.createElementNS(_W_NS, 'w:t')
    if (text.startsWith(' ') || text.endsWith(' ')) t.setAttribute('xml:space', 'preserve')
    t.textContent = text; r.appendChild(t); paraEl.appendChild(r)
  }
}

function _setCellText(xmlDoc, tcEl, text) {
  const paras = _kids(tcEl, 'w:p')
  if (paras.length) {
    _setParaText(xmlDoc, paras[0], text)
    paras.slice(1).forEach(p => tcEl.removeChild(p))
  } else {
    const p = xmlDoc.createElementNS(_W_NS, 'w:p')
    const r = xmlDoc.createElementNS(_W_NS, 'w:r')
    const t = xmlDoc.createElementNS(_W_NS, 'w:t')
    t.textContent = text; r.appendChild(t); p.appendChild(r); tcEl.appendChild(p)
  }
}

function _writeTable(sec, tblEl, rows, xmlDoc, data) {
  if (!rows.length) return
  const hN = _kids(rows[0], 'w:tc').map(tc => _norm(_getText(tc)))
  const colIdx = {}
  sec.cols.forEach(c => { const idx = hN.findIndex(h => h === _norm(c.l)); if (idx >= 0) colIdx[idx] = c.k })
  const tmpl = rows.length > 1 ? rows[1] : rows[0]
  rows.slice(1).forEach(r => tblEl.removeChild(r))
  const dr = data[sec.id] || [];
  (dr.length ? dr : [null]).forEach(dataRow => {
    const newRow = tmpl.cloneNode(true)
    _kids(newRow, 'w:tc').forEach((tc, ci) => {
      _setCellText(xmlDoc, tc, dataRow && colIdx[ci] ? (dataRow[colIdx[ci]] || '') : '')
    })
    tblEl.appendChild(newRow)
  })
}

function _writeSection(sec, kids, i, body, xmlDoc, data, themes) {
  while (i < kids.length && kids[i].tagName === 'w:p' && !_getText(kids[i]).trim()) i++
  const isHd = el => el.tagName === 'w:p' && _paraStyle(el).startsWith('Heading')

  if (sec.type === 'table') {
    while (i < kids.length) {
      const el = kids[i]; if (isHd(el)) break
      if (el.tagName === 'w:tbl') {
        const rows = _kids(el, 'w:tr')
        const hN = rows.length ? _kids(rows[0], 'w:tc').map(tc => _norm(_getText(tc))) : []
        const mc = sec.cols.filter(c => hN.some(h => h === _norm(c.l))).length
        i++; if (mc >= 2) { _writeTable(sec, el, rows, xmlDoc, data); break } continue
      }
      i++
    }
  } else if (sec.type === 'keyval') {
    const pe = []
    while (i < kids.length) { const el = kids[i]; if (isHd(el) || el.tagName === 'w:tbl') break; if (el.tagName === 'w:p') pe.push(el); i++ }
    sec.fields.forEach((field, idx) => { if (idx < pe.length) _setParaText(xmlDoc, pe[idx], field.l + ': ' + (themes[field.k] || '')) })
  } else if (sec.type === 'textarea') {
    const pe = []
    while (i < kids.length) { const el = kids[i]; if (isHd(el) || el.tagName === 'w:tbl') break; if (el.tagName === 'w:p') pe.push(el); i++ }
    const text = data[sec.id] || ''
    if (pe.length) { _setParaText(xmlDoc, pe[0], text); pe.slice(1).forEach(p => _setParaText(xmlDoc, p, '')) }
  } else if (sec.type === 'eow') {
    const H3 = { 'what went well': 'well', 'what did not': 'didNot', 'carry forward to next week': 'carry' }
    const groups = []; let curKey = null, curParas = []
    while (i < kids.length) {
      const el = kids[i], sty = _paraStyle(el)
      if (el.tagName === 'w:p' && (sty === 'Heading1' || sty === 'Heading2')) break
      if (el.tagName === 'w:p' && sty === 'Heading3') {
        if (curKey) groups.push({ key: curKey, paraEls: curParas })
        curKey = H3[_norm(_getText(el))] || null; curParas = []
      } else if (el.tagName === 'w:p' && curKey) curParas.push(el)
      i++
    }
    if (curKey) groups.push({ key: curKey, paraEls: curParas })
    const eow = data[sec.id] || {}
    groups.forEach(g => {
      const text = eow[g.key] || ''
      if (g.paraEls.length) { _setParaText(xmlDoc, g.paraEls[0], text); g.paraEls.slice(1).forEach(p => _setParaText(xmlDoc, p, '')) }
    })
  }
  return i
}

function _writeDoc(xmlDoc, data, themes) {
  const body = xmlDoc.getElementsByTagName('w:body')[0]; if (!body) return
  const kids = Array.from(body.children)
  let i = 0
  while (i < kids.length) {
    const el = kids[i]
    if (el.tagName === 'w:p' && _paraStyle(el).startsWith('Heading')) {
      const secId = DOCX_HEADING_MAP[_norm(_getText(el).trim())]
      if (secId) {
        const sec = PLANNER_SECTIONS.find(s => s.id === secId)
        if (sec) { i++; i = _writeSection(sec, kids, i, body, xmlDoc, data, themes); continue }
      }
    }
    i++
  }
}

export async function plannerExportDocx(data, themes, dateLabel) {
  try {
    const resp = await fetch('/templates/Weekly_Planner.docx')
    if (!resp.ok) throw new Error('Could not load template (HTTP ' + resp.status + ')')
    const zip = await JSZip.loadAsync(await resp.arrayBuffer())
    const xmlStr = await zip.file('word/document.xml').async('string')
    const xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml')
    if (xmlDoc.querySelector('parsererror')) throw new Error('Template XML is malformed.')
    _writeDoc(xmlDoc, data, themes)
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc))
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'planner-' + (dateLabel || new Date().toISOString().slice(0, 10)) + '.docx'
    a.click(); URL.revokeObjectURL(a.href)
  } catch (err) {
    alert('Word export failed:\n' + err.message)
  }
}
```

- [ ] **Step 4: Export `plannerExportDocx` from `packages/ui/src/index.js`**

Add after the existing planner exports block (after line ~119):

```js
export { plannerExportDocx } from './planner/docx.js'
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/planner/docx.js packages/ui/src/index.js packages/ui/package.json package-lock.json
git commit -m "feat(ui): add plannerExportDocx to @nexusmd/ui (jszip + docx template fill)"
```

---

### Task 4: Create shared `PlannerView` in `@nexusmd/ui`

**Files:**
- Create: `packages/ui/src/views/view-planner.jsx`
- Modify: `packages/ui/src/index.js`

**Interfaces:**
- Consumes: `getPlannerRuntime()` from `'../planner/runtime.js'`; `PLANNER_SECTIONS`, `PL_GROUPS`, `plSectionGroup`, `getIsoWeek`, `getYearWeekForOffset`, `fmtDateShort`, `buildEmptyPlannerData`, `hasMeaningfulPlannerData`, `PL_OPEN`, `plIsOverdueYmd` from `'@nexusmd/core'`; `plannerExportDocx` from `'../planner/docx.js'`; all planner subsystem imports (editors, glance, modals, storage, notes, confidential)
- Produces: `PlannerView({ data, setData, themes, setThemes, onExportDocx? })` — memoized, runtime-driven

- [ ] **Step 1: Create `packages/ui/src/views/view-planner.jsx`**

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'
import { NotificationBanner, Sheet } from '../app-components.jsx'
import { getPlannerRuntime } from '../planner/runtime.js'
import {
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  getIsoWeek, getYearWeekForOffset, fmtDateShort,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
  PL_OPEN, plIsOverdueYmd,
} from '@nexusmd/core'
import { PlModal, PlFld } from '../planner-chips.jsx'
import { plNewRow, plScrollToEl } from '../planner/primitives.jsx'
import { WorkItemCtxLayer, GlobalNotesView, loadGlobalNotes, saveGlobalNotes } from '../planner/planner-notes.jsx'
import { SectionCard } from '../planner/planner-editors.jsx'
import { GlanceView, CarryOverModal, collectCarryItems } from '../planner/planner-glance.jsx'
import {
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner, getWeeksWithData,
  isLegacyMigrationDone, markLegacyMigrationDone, checkConfidentialReminders,
} from '../planner/planner-storage.js'
import { loadConfidentialConfig, saveConfidentialConfig } from '../planner/planner-confidential.js'
import {
  loadVersions, saveVersions, describeSnapshot,
  ImportModal, VersionsModal, ConfidentialSetPasswordModal, ConfidentialUnlockModal,
  WeekCalendarPicker, PlHeaderMenu, PlMenuItem, PlMenuRadio, DeleteWeekModal,
} from '../planner/planner-modals.jsx'
import { plannerExportDocx as _defaultExportDocx } from '../planner/docx.js'

const { useState, useEffect, useMemo, useRef, useCallback, memo } = React

function PlannerView({ data, setData, themes, setThemes, onExportDocx }) {
  const rt = getPlannerRuntime()
  const ns = rt.namespace

  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width:600px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)')
    const handler = e => setIsPhone(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [navMode, setNavMode] = useState(() => {
    const stored = rt.storage.getItem(`${ns}.planner.nav`)
    if (stored) return stored
    return window.matchMedia('(max-width:600px)').matches ? 'tabs' : 'rail'
  })
  const [entryMode, setEntryMode] = useState(() => {
    const stored = rt.storage.getItem(`${ns}.planner.entry`)
    if (stored) return stored
    return window.matchMedia('(max-width:600px)').matches ? 'quickadd' : 'inline'
  })
  const effectiveNavMode = isPhone && navMode === 'rail' ? 'tabs' : navMode
  useEffect(() => { rt.storage.setItem(`${ns}.planner.nav`, navMode); rt.pushPref?.(`${ns}.planner.nav`, navMode) }, [navMode])
  useEffect(() => { rt.storage.setItem(`${ns}.planner.entry`, entryMode); rt.pushPref?.(`${ns}.planner.entry`, entryMode) }, [entryMode])

  const [activeGroup, setActiveGroup] = useState(() => {
    const landing = rt.storage.getItem(`${ns}.planner.landing`) || 'glance'
    return landing === 'sections' ? PL_GROUPS[0].id : 'overview'
  })
  const [weekOffset, setWeekOffset] = useState(0)
  const [modal, setModal] = useState(null)
  const [flash, setFlash] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [weeksWithData, setWeeksWithData] = useState(() => getWeeksWithData())
  const [isNewWeek, setIsNewWeek] = useState(false)
  const [pendingNotification, setPendingNotification] = useState(null)
  const [dueReminders, setDueReminders] = useState([])
  const [highlightedRowId, setHighlightedRowId] = useState(null)
  const [carryDismissed, setCarryDismissed] = useState(false)
  const [confCfg, setConfCfg] = useState(() => loadConfidentialConfig())
  const [unlockedSections, setUnlockedSections] = useState(() => new Set())
  const [pendingUnlockSectionId, setPendingUnlockSectionId] = useState(null)
  const [pendingMark, setPendingMark] = useState(null)
  const [pendingMarkRow, setPendingMarkRow] = useState(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureType, setCaptureType] = useState(null)
  const [captureText, setCaptureText] = useState('')
  const [gNotes, setGNotesRaw] = useState(() => loadGlobalNotes())
  const setGNotes = useCallback((fn) => setGNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn
    saveGlobalNotes(next)
    return next
  }), [])
  const [plannerSyncRev, setPlannerSyncRev] = useState(0)

  const calendarRef = useRef(null)
  const isFirstLoad = useRef(true)
  const readyToSave = useRef(false)
  const saveTimer = useRef(null)
  const latestRef = useRef({ data, themes, weekOffset })

  useEffect(() => { latestRef.current = { data, themes, weekOffset } })

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      if (!readyToSave.current) return
      const { data: d, themes: t, weekOffset: wo } = latestRef.current
      const { year, week } = getYearWeekForOffset(wo)
      if (hasMeaningfulPlannerData(d, t)) saveWeekPlanner(year, week, d, t)
    }
  }, [])

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 2600) }

  useEffect(() => {
    const nav = window.NexusMDNav
    if (nav?.view === 'planner') {
      if (nav.pendingFilter) {
        const g = plSectionGroup(nav.pendingFilter)
        if (g) setActiveGroup(g.id)
        setTimeout(() => plScrollToEl('sec-' + nav.pendingFilter), 80)
      }
      if (nav.notification) setPendingNotification(nav.notification)
      window.NexusMDNav = null
    }
  }, [])

  useEffect(() => {
    const due = checkConfidentialReminders()
    if (due.length > 0) setDueReminders(due)
  }, [])

  useEffect(() => {
    if (!calendarOpen) return
    const onDoc = e => { if (calendarRef.current && !calendarRef.current.contains(e.target)) setCalendarOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [calendarOpen])

  useEffect(() => {
    const handler = (e) => {
      const collId = e.detail?.collId
      if (collId === 'planner') setPlannerSyncRev(r => r + 1)
      else if (collId === 'notes') setGNotesRaw(loadGlobalNotes())
    }
    document.addEventListener('nexusmd:sync-applied', handler)
    return () => document.removeEventListener('nexusmd:sync-applied', handler)
  }, [])

  useEffect(() => {
    readyToSave.current = false
    const { year, week } = getYearWeekForOffset(weekOffset)
    const saved = loadWeekPlanner(year, week)

    if (isFirstLoad.current) {
      isFirstLoad.current = false
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        setData(d => ({ ...d, ...saved.data }))
        if (saved.themes) setThemes(t => ({ ...t, ...saved.themes }))
        setIsNewWeek(false)
      } else if (!saved && hasMeaningfulPlannerData(data, themes)
                 && !isLegacyMigrationDone() && getWeeksWithData().size === 0) {
        saveWeekPlanner(year, week, data, themes)
        markLegacyMigrationDone()
        setWeeksWithData(getWeeksWithData())
        setIsNewWeek(false)
      } else {
        markLegacyMigrationDone()
        setData({})
        setThemes({})
        setIsNewWeek(true)
      }
    } else {
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        const newData = buildEmptyPlannerData()
        for (const sec of PLANNER_SECTIONS) {
          if (saved.data[sec.id] != null) newData[sec.id] = saved.data[sec.id]
        }
        if (saved.data._carriedOver) newData._carriedOver = true
        setData(newData)
        setThemes(saved.themes || {})
        setIsNewWeek(false)
      } else {
        setData({})
        setThemes({})
        setIsNewWeek(true)
      }
    }
    setCarryDismissed(false)
    setTimeout(() => { readyToSave.current = true }, 60)
  }, [weekOffset, plannerSyncRev])

  useEffect(() => {
    if (!readyToSave.current) return
    clearTimeout(saveTimer.current)
    const { year, week } = getYearWeekForOffset(weekOffset)
    saveTimer.current = setTimeout(() => {
      if (hasMeaningfulPlannerData(data, themes)) {
        saveWeekPlanner(year, week, data, themes)
      } else {
        deleteWeekPlanner(year, week)
      }
      setWeeksWithData(getWeeksWithData())
    }, 600)
  }, [data, themes])

  const prevWeekData = useMemo(() => {
    const { year, week } = getYearWeekForOffset(weekOffset - 1)
    return loadWeekPlanner(year, week)
  }, [weekOffset, weeksWithData])
  const carryItems = useMemo(() => collectCarryItems(prevWeekData?.data, PLANNER_SECTIONS), [prevWeekData])
  const carryPromptEnabled = (rt.storage.getItem(`${ns}.planner.carryPrompt`) || '1') !== '0'
  const showCarryBanner = carryPromptEnabled && !isNewWeek && carryItems.length > 0 && !data._carriedOver && !carryDismissed

  const handleCarry = (selected) => {
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d }
      selected.forEach(i => {
        const arr = (base[i.section.id] || []).slice()
        arr.push({ ...i.row, id: 'co' + Date.now() + Math.random().toString(36).slice(2, 5) })
        base[i.section.id] = arr
      })
      base._carriedOver = true
      return base
    })
    if (isNewWeek) { setThemes({}); setIsNewWeek(false) }
    setModal(null)
    showFlash(`Carried over ${selected.length} item${selected.length !== 1 ? 's' : ''} from last week.`)
  }

  const handleCreateEntry = () => {
    setData(buildEmptyPlannerData())
    setThemes({})
    setIsNewWeek(false)
  }

  const handleMarkConfidential = (sectionId) => {
    if (!confCfg.hash) { setPendingMark(sectionId); setModal('setpw') }
    else {
      const newCfg = { ...confCfg, sections: [...confCfg.sections, sectionId] }
      setConfCfg(newCfg); saveConfidentialConfig(newCfg)
    }
  }
  const handleRemoveConfidential = (sectionId) => {
    const newCfg = { ...confCfg, sections: confCfg.sections.filter(id => id !== sectionId) }
    setConfCfg(newCfg); saveConfidentialConfig(newCfg)
  }
  const handleLockRow = (sectionId, rowId) => {
    if (!confCfg.hash) { setPendingMarkRow({ sectionId, rowId }); setModal('setpw') }
    else setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }))
  }
  const handleUnlockRow = (sectionId, rowId) => {
    setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: false } : r) }))
  }
  const handlePasswordSaved = (hash) => {
    const newCfg = { hash, sections: pendingMark ? [...confCfg.sections, pendingMark] : confCfg.sections }
    setConfCfg(newCfg); saveConfidentialConfig(newCfg)
    setPendingMark(null)
    if (pendingMarkRow) {
      const { sectionId, rowId } = pendingMarkRow
      setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }))
      setPendingMarkRow(null)
    }
  }

  const weekLabel = useMemo(() => {
    const now = new Date()
    const day = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - day + 1 + weekOffset * 7)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const wk = getIsoWeek(monday)
    return { short: `W${wk}`, full: `Week ${wk} · ${fmtDateShort(monday)} - ${fmtDateShort(sunday)}` }
  }, [weekOffset])

  const { year: cYear, week: cWeek } = getYearWeekForOffset(weekOffset)
  const currentHasData = weeksWithData.has(`${cYear}-W${String(cWeek).padStart(2, '0')}`)
  const lockedRowCount = useMemo(() => PLANNER_SECTIONS.reduce((n, s) =>
    n + (s.type === 'table' ? (data[s.id] || []).filter(r => r._confidential && !unlockedSections.has(s.id)).length : 0), 0), [data, unlockedSections])
  const lockedCount = confCfg.sections.filter(id => !unlockedSections.has(id)).length + lockedRowCount

  const exportJson = () => {
    const payload = { data, themes, exportedAt: new Date().toISOString() }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `planner-${new Date().toISOString().slice(0,10)}.json`
    a.click(); URL.revokeObjectURL(a.href)
  }
  const handleImport = (importedData, importedThemes) => {
    if (importedData && typeof importedData === 'object') setData(d => ({ ...d, ...importedData }))
    if (importedThemes && typeof importedThemes === 'object') setThemes(t => ({ ...t, ...importedThemes }))
    if (isNewWeek) setIsNewWeek(false)
    showFlash('Imported successfully.')
  }
  const handleRestore = (restoredData, restoredThemes) => {
    if (restoredData && typeof restoredData === 'object') setData(d => ({ ...d, ...restoredData }))
    if (restoredThemes && typeof restoredThemes === 'object') setThemes(t => ({ ...t, ...restoredThemes }))
    if (isNewWeek) setIsNewWeek(false)
    showFlash('Snapshot restored.')
  }
  const handleDeleteWeek = () => {
    const { year, week } = getYearWeekForOffset(weekOffset)
    deleteWeekPlanner(year, week)
    setData({})
    setThemes({})
    setIsNewWeek(true)
    setWeeksWithData(getWeeksWithData())
    showFlash(`${weekLabel.short} deleted.`)
  }

  const handleViewNotification = useCallback(() => {
    if (!pendingNotification) return
    const { sectionId, personName, date } = pendingNotification
    const g = plSectionGroup(sectionId)
    if (g) setActiveGroup(g.id)
    setTimeout(() => plScrollToEl('sec-' + sectionId), 80)
    if (sectionId === 'oneOnOnes') {
      const row = (data.oneOnOnes || []).find(
        r => r.person?.toLowerCase() === (personName || '').toLowerCase() && r.date === date
      )
      if (row) { setHighlightedRowId(row.id); setTimeout(() => setHighlightedRowId(null), 2500) }
    }
    setPendingNotification(null)
  }, [pendingNotification, data])

  const handleViewReminder = useCallback(() => {
    if (!dueReminders.length) return
    const first = dueReminders[0]
    if (first.weekOffset !== 0) setWeekOffset(first.weekOffset)
    const g = plSectionGroup(first.sectionId)
    if (g) setActiveGroup(g.id)
    setTimeout(() => plScrollToEl('sec-' + first.sectionId), 100)
    setHighlightedRowId(first.rowId)
    setTimeout(() => setHighlightedRowId(null), 2500)
    const dismissKey = `${ns}.planner.reminderDismissed`
    const dismissed = new Set()
    try { JSON.parse(rt.storage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)) } catch {}
    dismissed.add(first.rowId + ':' + first.reminderDate)
    try { rt.storage.setItem(dismissKey, JSON.stringify([...dismissed])) } catch {}
    setDueReminders(prev => prev.slice(1))
  }, [dueReminders, ns, rt])

  const handleDismissReminders = useCallback(() => {
    const dismissKey = `${ns}.planner.reminderDismissed`
    const dismissed = new Set()
    try { JSON.parse(rt.storage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)) } catch {}
    dueReminders.forEach(r => dismissed.add(r.rowId + ':' + r.reminderDate))
    try { rt.storage.setItem(dismissKey, JSON.stringify([...dismissed])) } catch {}
    setDueReminders([])
  }, [dueReminders, ns, rt])

  const rowVisible = useCallback((sec, row) => {
    if (!sec) return false
    if (confCfg.sections.includes(sec.id) && !unlockedSections.has(sec.id)) return false
    if (row._confidential && !unlockedSections.has(sec.id)) return false
    return true
  }, [confCfg, unlockedSections])

  const addTaskFromNote = (title) => {
    const sec = PLANNER_SECTIONS.find(s => s.id === 'tasks')
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d }
      base.tasks = [...(base.tasks || []), plNewRow(sec, { task: title, priority: '3 - Medium' })]
      return base
    })
    if (isNewWeek) { setThemes({}); setIsNewWeek(false) }
    showFlash(`Added as a task in ${weekLabel.short}.`)
  }

  const handleCaptureSave = () => {
    const text = captureText.trim()
    if (!text || !captureType) return
    if (captureType === 'note') {
      setGNotes(prev => [...prev, { id: 'n' + Date.now(), text, status: 'open', createdAt: new Date().toISOString() }])
    } else {
      const secMap = { task: ['tasks', 'task'], meeting: ['meetSched', 'meeting'], wi: ['workItemsPlan', 'title'] }
      const [secId, field] = secMap[captureType]
      const sec = PLANNER_SECTIONS.find(s => s.id === secId)
      const extra = captureType === 'task' ? { priority: '3 - Medium' } : {}
      setData(d => {
        const base = isNewWeek ? buildEmptyPlannerData() : { ...d }
        base[secId] = [...(base[secId] || []), plNewRow(sec, { [field]: text, ...extra })]
        return base
      })
      if (isNewWeek) { setThemes({}); setIsNewWeek(false) }
    }
    showFlash('Captured.')
    setCaptureOpen(false)
    setCaptureText('')
    setCaptureType(null)
  }

  const sectionProps = (sectionId) => ({
    isConfidential: confCfg.sections.includes(sectionId),
    sessionUnlocked: unlockedSections.has(sectionId),
    onMarkConfidential:   () => handleMarkConfidential(sectionId),
    onRemoveConfidential: () => handleRemoveConfidential(sectionId),
    onUnlockRequest:      () => { setPendingUnlockSectionId(sectionId); setModal('unlock') },
    onLockRow:   (rowId) => handleLockRow(sectionId, rowId),
    onUnlockRow: (rowId) => handleUnlockRow(sectionId, rowId),
  })

  const renderSection = (sec) => (
    <SectionCard key={sec.id} section={sec} data={data} setData={setData} themes={themes} setThemes={setThemes}
      entryStyle={entryMode} domId={'sec-' + sec.id}
      highlightedRowId={highlightedRowId}
      meetingOptions={sec.id === 'meetNotes' ? (data.meetSched || []) : null}
      {...sectionProps(sec.id)}/>
  )

  const groupHeader = (g) => (
    <div key={'h' + g.id} id={'grp-' + g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 10px', scrollMarginTop: 16 }}>
      <span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={g.icon} size={14}/></span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }}></span>
    </div>
  )

  const openGroup = (gid) => {
    setActiveGroup(gid)
    if (effectiveNavMode === 'scroll') setTimeout(() => plScrollToEl('grp-' + gid), 30)
  }
  const openSection = (sid) => {
    const g = plSectionGroup(sid)
    setActiveGroup(g ? g.id : 'overview')
    setTimeout(() => plScrollToEl('sec-' + sid), 80)
  }

  const openNotesCount = gNotes.filter(n => n.status !== 'done').length
  const navGroups = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'mynotes', label: 'Notes', icon: 'pin' },
    ...PL_GROUPS,
  ]

  const navStats = useMemo(() => {
    const stats = {}
    navGroups.forEach(g => {
      if (!g.ids) return
      let counts = 0, hasAlert = false
      const secLockedHere = g.ids.some(id => confCfg.sections.includes(id) && !unlockedSections.has(id))
      g.ids.forEach(id => {
        const sec = PLANNER_SECTIONS.find(s => s.id === id)
        if (!sec || sec.type !== 'table') return
        const rows = data[id] || []
        const dc = sec.cols.find(c => c.t === 'date')
        rows.forEach(r => {
          if (!rowVisible(sec, r)) return
          if (PL_OPEN(r.status || '')) counts++
          if (!hasAlert && (r.status === 'Blocked' || (dc && plIsOverdueYmd(r[dc.k], r.status)))) hasAlert = true
        })
      })
      stats[g.id] = { counts, hasAlert, secLockedHere }
    })
    return stats
  }, [data, confCfg, unlockedSections, rowVisible])

  const glance = (
    <GlanceView data={data} themes={themes} sections={PLANNER_SECTIONS} groups={PL_GROUPS}
      onOpenGroup={openGroup} onOpenSection={openSection} rowVisible={rowVisible}
      carryCount={showCarryBanner ? carryItems.length : 0} onOpenCarry={() => setModal('carry')}/>
  )
  const notesView = (
    <GlobalNotesView notes={gNotes} setNotes={setGNotes} weekLabel={weekLabel.short} onAddTask={addTaskFromNote}/>
  )

  const modals = (
    <React.Fragment>
      <ImportModal open={modal === 'import'} onClose={() => setModal(null)} onImport={handleImport}/>
      <VersionsModal open={modal === 'versions'} onClose={() => setModal(null)} currentData={data} currentThemes={themes} onRestore={handleRestore}/>
      <ConfidentialSetPasswordModal
        open={modal === 'setpw'} existingHash={confCfg.hash}
        onClose={() => { setModal(null); setPendingMark(null); setPendingMarkRow(null) }}
        onSaved={handlePasswordSaved}/>
      <ConfidentialUnlockModal
        open={modal === 'unlock'} onClose={() => setModal(null)}
        onUnlocked={() => {
          const latestCfg = loadConfidentialConfig()
          setConfCfg(latestCfg)
          if (pendingUnlockSectionId !== null) {
            setUnlockedSections(prev => new Set([...prev, pendingUnlockSectionId]))
          } else {
            setUnlockedSections(new Set([...latestCfg.sections, ...PLANNER_SECTIONS.map(s => s.id)]))
          }
          setPendingUnlockSectionId(null)
        }}/>
      <CarryOverModal open={modal === 'carry'} onClose={() => { setModal(null); setCarryDismissed(true) }}
        items={carryItems} prevLabel={`W${getYearWeekForOffset(weekOffset - 1).week}`} onCarry={handleCarry}/>
      <DeleteWeekModal open={modal === 'delete-week'} onClose={() => setModal(null)}
        weekLabel={weekLabel} onConfirm={handleDeleteWeek}/>
      <WorkItemCtxLayer/>
    </React.Fragment>
  )

  const handleExportDocx = () => {
    const dateStr = new Date().toISOString().slice(0, 10)
    if (onExportDocx) onExportDocx(data, themes, dateStr)
    else _defaultExportDocx(data, themes, dateStr)
  }

  const header = (
    <div className="page-head">
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Planner</h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{weekLabel.full}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:2, position:'relative' }} ref={calendarRef}>
          <button type="button" className="m-iconbtn" onClick={() => setWeekOffset(w => w - 1)} title="Previous week">
            <Icon name="chevron-left" size={16}/>
          </button>
          <button type="button" className="btn sm ghost"
            style={{ fontWeight:600, fontFamily:'var(--mono)', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}
            onClick={() => setCalendarOpen(o => !o)}>
            {weekLabel.short}
            {currentHasData && <span style={{ width:5, height:5, borderRadius:'50%', background:'var(--success)', flexShrink:0 }}/>}
          </button>
          <button type="button" className="m-iconbtn" onClick={() => setWeekOffset(w => w + 1)} title="Next week">
            <Icon name="chevron-right" size={16}/>
          </button>
          {weekOffset !== 0 && (
            <button type="button" className="btn sm ghost" onClick={() => setWeekOffset(0)} style={{ fontSize:11 }}>Today</button>
          )}
          {calendarOpen && (
            <WeekCalendarPicker weekOffset={weekOffset} onSelectOffset={setWeekOffset}
              weeksWithData={weeksWithData} onClose={() => setCalendarOpen(false)}/>
          )}
        </div>
        {lockedCount > 0 && (
          <button type="button" className="m-iconbtn" title={`${lockedCount} locked`}
            onClick={() => { setPendingUnlockSectionId(null); setModal('unlock') }}>
            <Icon name="lock" size={16}/>
          </button>
        )}
        {unlockedSections.size > 0 && (
          <button type="button" className="m-iconbtn" title="Re-lock" style={{ color:'var(--accent)' }}
            onClick={() => setUnlockedSections(new Set())}>
            <Icon name="lock" size={16}/>
          </button>
        )}
        {!isNewWeek && (
          <PlHeaderMenu label="" icon="more">
            {(close) => (
              <React.Fragment>
                <PlMenuRadio heading="Navigation" value={navMode}
                  options={[['rail','Rail'],['scroll','Scroll'],['tabs','Tabs']]} onChange={setNavMode}/>
                <PlMenuRadio heading="Entry style" value={entryMode}
                  options={[['inline','Inline'],['quickadd','Quick-add'],['drawer','Drawer']]} onChange={setEntryMode}/>
                <div style={{ height:1, background:'var(--border)', margin:'3px 6px' }}/>
                <PlMenuItem icon="inbox" label="Import JSON…" onClick={() => { close(); setModal('import') }}/>
                <PlMenuItem icon="send" label="Export JSON" onClick={() => { close(); exportJson() }}/>
                <PlMenuItem icon="send" label="Export Word (.docx)" onClick={() => { close(); handleExportDocx() }}/>
                <div style={{ height:1, background:'var(--border)', margin:'3px 6px' }}/>
                <PlMenuItem icon="clock" label="Versions…" onClick={() => { close(); setModal('versions') }}/>
                <div style={{ height:1, background:'var(--border)', margin:'3px 6px' }}/>
                <PlMenuItem icon="trash" label="Delete week…" danger onClick={() => { close(); setModal('delete-week') }}/>
              </React.Fragment>
            )}
          </PlHeaderMenu>
        )}
      </div>
    </div>
  )

  if (isNewWeek) {
    const content = (
      <div className="pl-empty-week">
        <span className="plm-ic" style={{ width: 52, height: 52, borderRadius: 14 }}><Icon name="planner" size={22}/></span>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>No planner for this week</div>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>{weekLabel.full}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={handleCreateEntry}><Icon name="plus" size={14}/> Make new entry</button>
          {carryItems.length > 0 && (
            <button className="btn primary" onClick={() => setModal('carry')}>
              <Icon name="refresh" size={13}/> Carry over {carryItems.length} unfinished
            </button>
          )}
        </div>
        {carryItems.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {carryItems.filter(i => i.why === 'overdue').length} overdue · {carryItems.filter(i => i.why === 'blocked').length} blocked · from last week
          </div>
        )}
      </div>
    )
    return (
      <React.Fragment>
        {header}
        {isPhone ? <div className="m-screen">{content}</div> : content}
        {modals}
      </React.Fragment>
    )
  }

  const captureTypeOptions = [
    { id:'note', label:'Note', icon:'edit' },
    { id:'task', label:'Task', icon:'check' },
    { id:'meeting', label:'Meeting', icon:'planner' },
    { id:'wi', label:'Work Item', icon:'work' },
  ]
  const capturePlaceholders = { note:'Quick note…', task:'Task title…', meeting:'Meeting name…', wi:'Work item title…' }

  const innerContent = (
    <React.Fragment>
      {dueReminders.length > 0 && (
        <NotificationBanner
          label={dueReminders.length === 1
            ? `Reminder due: confidential entry (${dueReminders[0].reminderDate})`
            : `${dueReminders.length} reminders due on confidential entries`}
          onView={handleViewReminder}
          onDismiss={handleDismissReminders}
        />
      )}
      {pendingNotification && (
        <NotificationBanner
          label={pendingNotification.label}
          onView={handleViewNotification}
          onDismiss={() => setPendingNotification(null)}
        />
      )}
      {flash && <div className="pl-flash"><Icon name="check-circle" size={13}/> {flash}</div>}

      {effectiveNavMode === 'rail' && (
        <div className="pl-layout">
          <nav className="pl-rail">
            {navGroups.map(g => {
              const { counts = 0, hasAlert = false, secLockedHere = false } = navStats[g.id] || {}
              return (
                <button key={g.id} className={`pl-rail-item ${activeGroup === g.id ? 'active' : ''}`} onClick={() => setActiveGroup(g.id)}>
                  <span className="ic"><Icon name={g.icon} size={14}/></span>
                  {g.label}
                  {g.id === 'mynotes' && openNotesCount > 0 && <span className="count">{openNotesCount}</span>}
                  {g.ids && (hasAlert ? <span className="dot-alert" title="Overdue or blocked items"></span>
                    : secLockedHere && counts === 0 ? <Icon name="lock" size={10} style={{ marginLeft: 'auto', opacity: .4 }}/>
                    : counts > 0 ? <span className="count">{counts}</span> : null)}
                </button>
              )
            })}
          </nav>
          <div style={{ minWidth: 0 }}>
            {activeGroup === 'overview' ? glance
              : activeGroup === 'mynotes' ? notesView
              : (PL_GROUPS.find(g => g.id === activeGroup) || PL_GROUPS[0]).ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
          </div>
        </div>
      )}

      {effectiveNavMode === 'scroll' && (
        <div>
          <div id="grp-overview" style={{ marginBottom: 8 }}>{glance}</div>
          {PL_GROUPS.map(g => (
            <React.Fragment key={g.id}>
              {groupHeader(g)}
              {g.ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
            </React.Fragment>
          ))}
          {groupHeader({ id: 'mynotes', label: 'Notes (week-agnostic)', icon: 'pin' })}
          {notesView}
        </div>
      )}

      {effectiveNavMode === 'tabs' && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <div className="pl-seg">
              {navGroups.map(g => (
                <button key={g.id} className={activeGroup === g.id ? 'active' : ''} onClick={() => setActiveGroup(g.id)}>
                  <Icon name={g.icon} size={12}/>{g.label}
                </button>
              ))}
            </div>
          </div>
          {activeGroup === 'overview' ? glance
            : activeGroup === 'mynotes' ? notesView
            : (PL_GROUPS.find(g => g.id === activeGroup) || PL_GROUPS[0]).ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
        </div>
      )}
    </React.Fragment>
  )

  return (
    <React.Fragment>
      {header}

      {effectiveNavMode === 'scroll' && (
        <div className="pl-chipnav" style={{
          position: 'relative', zIndex: 5,
          borderBottom: '1px solid var(--border)',
          padding: '8px 14px', margin: 0,
        }}>
          {navGroups.map(g => (
            <button key={g.id} className={`pl-chip ${activeGroup === g.id ? 'active' : ''}`}
              onClick={() => { setActiveGroup(g.id); plScrollToEl('grp-' + g.id) }}>
              <Icon name={g.icon} size={12}/>{g.label}
            </button>
          ))}
        </div>
      )}

      {isPhone ? <div className="m-screen">{innerContent}</div> : innerContent}

      {isPhone && (
        <React.Fragment>
          <button type="button" className="m-fab" onClick={() => setCaptureOpen(true)} aria-label="Quick capture">
            <Icon name="plus" size={24}/>
          </button>
          <Sheet open={captureOpen} icon="plus" title="Quick capture"
            onClose={() => { setCaptureOpen(false); setCaptureText(''); setCaptureType(null) }}>
            {!captureType ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {captureTypeOptions.map(t => (
                  <button key={t.id} type="button" className="m-action"
                    onClick={() => setCaptureType(t.id)}>
                    <span className="ai"><Icon name={t.icon} size={18}/></span>
                    <span className="at">{t.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <input type="text" autoFocus value={captureText}
                  onChange={e => setCaptureText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCaptureSave() }}
                  placeholder={capturePlaceholders[captureType] || 'Enter text…'}
                  style={{ padding:'10px 12px', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface-2)', font:'inherit', fontSize:15, color:'var(--text)', outline:'none' }}/>
                <div style={{ display:'flex', gap:8 }}>
                  <button type="button" className="btn ghost m-btn-lg" onClick={() => setCaptureType(null)}>Back</button>
                  <button type="button" className="btn primary m-btn-lg" style={{ flex:1 }} onClick={handleCaptureSave}>Add</button>
                </div>
              </div>
            )}
          </Sheet>
        </React.Fragment>
      )}

      {modals}
    </React.Fragment>
  )
}

export { memo(PlannerView) as PlannerView }
```

**Note:** The final export line uses the named-export-with-memo pattern. Write it as:
```js
const PlannerViewMemo = React.memo(PlannerView)
export { PlannerViewMemo as PlannerView }
```

- [ ] **Step 2: Export `PlannerView` from `packages/ui/src/index.js`**

Add at the end of the file (after the existing planner exports):

```js
export { PlannerView } from './views/view-planner.jsx'
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/views/view-planner.jsx packages/ui/src/index.js
git commit -m "feat(ui): add shared PlannerView orchestrator (runtime-driven, all platforms)"
```

---

### Task 5: Web migration

**Files:**
- Modify: `apps/web/src/view-planner.jsx`
- Modify: `apps/web/src/app.jsx`
- Delete: `apps/web/src/view-planner-2.jsx`

**Interfaces:**
- Consumes: `PlannerView` from `'@nexusmd/ui'` (via new re-export in web shim)
- Produces: All existing imports of `PlannerView` from `'./view-planner.jsx'` continue working

- [ ] **Step 1: Update `apps/web/src/view-planner.jsx`**

Remove the `JSZip` import (line 1), the `NEXUSMD_DOCX_HEADING_MAP` constant, and all `_hd*` helper functions and the `plannerExportDocx` function. Replace them with a re-export from `@nexusmd/ui`.

At the top of the file, the `import JSZip from 'jszip'` line is removed. The file's `@nexusmd/core` re-export block and `@nexusmd/ui` re-export block (lines ~2-23) stay unchanged.

After the existing `export { loadWeekPlanner, ... } from '@nexusmd/ui'` block, add:

```js
export { PlannerView, plannerExportDocx } from '@nexusmd/ui'
```

Delete everything from the `// ── DOCX export helpers` comment down through the end of the `plannerExportDocx` function. The remaining file is just the re-export block at the top plus the new line above.

- [ ] **Step 2: Update `apps/web/src/app.jsx` — PlannerView import source**

Line 23, change:
```js
import { PlannerView } from './view-planner-2.jsx';
```
to:
```js
import { PlannerView, plannerExportDocx } from './view-planner.jsx';
```

- [ ] **Step 3: Update `apps/web/src/app.jsx` — pass `onExportDocx` prop**

Find the `<PlannerView` usage (around line 2088). Change:
```jsx
<PlannerView data={plannerData} setData={setPlannerData} themes={themes} setThemes={setThemes}/>
```
to:
```jsx
<PlannerView data={plannerData} setData={setPlannerData} themes={themes} setThemes={setThemes} onExportDocx={plannerExportDocx}/>
```

- [ ] **Step 4: Delete `apps/web/src/view-planner-2.jsx`**

```bash
git rm apps/web/src/view-planner-2.jsx
```

- [ ] **Step 5: Verify the web build compiles**

```bash
cd apps/web && npm run build
```

Expected: No errors. If there are missing-export errors, check that all symbols previously imported from `view-planner-2.jsx` are now available from `view-planner.jsx` or `@nexusmd/ui`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/view-planner.jsx apps/web/src/app.jsx
git commit -m "feat(web): migrate PlannerView to shared @nexusmd/ui component"
```

---

### Task 6: App migration

**Files:**
- Modify: `apps/app/src/planner/view-planner.jsx`
- Modify: `apps/app/src/app.jsx`
- Modify: `apps/app/src/components.jsx`
- Delete: `apps/app/src/planner/view-planner-2.jsx`

**Interfaces:**
- Consumes: `PlannerView` from `'@nexusmd/ui'` (via updated app shim)
- Produces: `window.NexusMDNav` (renamed from `window.HelmNav`) read by shared PlannerView

- [ ] **Step 1: Update `apps/app/src/planner/view-planner.jsx` — remove local definitions**

Remove these items from the file:
1. `import JSZip from 'jszip'` (line 3)
2. The local `weekStorageKey` function (lines ~191-193) — the shared storage uses `getPlannerRuntime().namespace` directly; this leftover is unused
3. The local `hasMeaningfulPlannerData` function (lines ~198-211)
4. The local `buildEmptyPlannerData` function (lines ~213-222)
5. The local `PLANNER_SECTIONS` definition (lines ~235 to end of sections array) — now canonical in `@nexusmd/core`
6. The `plannerExportDocx` function and all `_hd*` helpers (the DOCX block starting with `const _HD_W_NS`)

Add to the `import { ... } from '@nexusmd/core'` block:
```js
import {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekKeyToOffset, PL_GROUPS, plSectionGroup,
  PLANNER_SECTIONS, buildEmptyPlannerData, hasMeaningfulPlannerData,
} from '@nexusmd/core';
```

Add to the re-exports at the bottom of the file:
```js
export {
  PLANNER_SECTIONS, buildEmptyPlannerData, hasMeaningfulPlannerData,
  PL_GROUPS, plSectionGroup,
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekKeyToOffset,
} from '@nexusmd/core';
export { PlannerView, plannerExportDocx } from '@nexusmd/ui';
```

Keep the existing re-exports of `loadWeekPlanner`, `saveWeekPlanner`, `loadVersions`, `hashPassword`, `loadConfidentialConfig`, etc. — those are already re-exported from `@nexusmd/ui`.

- [ ] **Step 2: Update `apps/app/src/app.jsx` — PlannerView import source**

Line 23, change:
```js
import { PlannerView } from './planner/view-planner-2.jsx';
```
to:
```js
import { PlannerView, plannerExportDocx } from './planner/view-planner.jsx';
```

- [ ] **Step 3: Rename `window.HelmNav` → `window.NexusMDNav` in `apps/app/src/app.jsx`**

Change line ~1727:
```js
window.HelmNav = { pendingFilter: section || null, view: 'planner', notification };
```
to:
```js
window.NexusMDNav = { pendingFilter: section || null, view: 'planner', notification };
```

Change line ~1877:
```js
window.HelmNav = { pendingFilter: e.detail.filter || null, view: target };
```
to:
```js
window.NexusMDNav = { pendingFilter: e.detail.filter || null, view: target };
```

- [ ] **Step 4: Pass `onExportDocx` to `PlannerView` in `apps/app/src/app.jsx`**

Find the planner case in the view switch (around line 1945). Change:
```jsx
case 'planner': return <PlannerView data={plannerData} setData={setPlannerData} .../>
```
to:
```jsx
case 'planner': return <PlannerView data={plannerData} setData={setPlannerData} themes={plannerThemes} setThemes={setPlannerThemes} onExportDocx={plannerExportDocx}/>
```

(Match the exact prop names used in the original case — adjust if they differ from the above.)

- [ ] **Step 5: Update `apps/app/src/components.jsx` — replace `Sheet` with re-export**

Remove the `Sheet` function definition (lines ~63-99) and replace with:
```js
export { Sheet } from '@nexusmd/ui'
```

The `NotificationBanner` re-export (line ~59) stays unchanged.

- [ ] **Step 6: Delete `apps/app/src/planner/view-planner-2.jsx`**

```bash
git rm apps/app/src/planner/view-planner-2.jsx
```

- [ ] **Step 7: Verify the app build compiles**

```bash
cd apps/app && npm run build
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/planner/view-planner.jsx apps/app/src/app.jsx apps/app/src/components.jsx
git commit -m "feat(app): migrate PlannerView to shared @nexusmd/ui, rename HelmNav → NexusMDNav"
```

---

### Task 7: Desktop wiring

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `PlannerView`, `MarkdownViewer` from `'@nexusmd/ui'`
- Produces: Desktop nav entries for `planner` and `markdown`; both views rendered in `ViewBody`

- [ ] **Step 1: Add imports to `apps/desktop/src/main.jsx`**

Find the existing `@nexusmd/ui` import block (lines ~8-14):
```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
} from '@nexusmd/ui'
```

Add `PlannerView, MarkdownViewer` to the list:
```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  PlannerView, MarkdownViewer,
} from '@nexusmd/ui'
```

- [ ] **Step 2: Add `markdown` nav entry to `NAV` array**

Find the `NAV` array (lines ~80-90). Add `markdown` before `settings`:
```js
const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work Items',     icon: 'work' },
  { id: 'prs',       label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',    label: 'Builds',         icon: 'build' },
  { id: 'tests',     label: 'Tests',          icon: 'check' },
  { id: 'team',      label: 'Team',           icon: 'team' },
  { id: 'triage',    label: 'Triage',         icon: 'work' },
  { id: 'planner',   label: 'Planner',        icon: 'planner' },
  { id: 'markdown',  label: 'Notes',          icon: 'pin' },
  { id: 'settings',  label: 'Settings',       icon: 'settings' },
]
```

- [ ] **Step 3: Wire cases in `ViewBody` switch**

In the `switch (view)` block in `ViewBody`, replace the `default` fallthrough for `planner` (which currently hits the `Placeholder`) and add `markdown`. Insert before the existing `case 'settings':`:

```js
case 'planner':
  return <PlannerView data={{}} setData={() => {}} themes={{}} setThemes={() => {}} />
case 'markdown':
  return <MarkdownViewer />
```

**Note:** `PlannerView` manages its own data via the `plannerRuntime` singleton set by `NexusDataProvider`. The `data`/`setData`/`themes`/`setThemes` props are the host's responsibility per the component contract — the desktop passes empty initial state and lets the internal load effect hydrate from storage. If the desktop's `NexusDataProvider` already has planner state wired (via `nexusDataValue`), pass those instead; otherwise the empty-initial-state approach is correct since the component loads from localStorage on mount.

- [ ] **Step 4: Verify the desktop compiles and the Planner/Notes views render**

```bash
cd apps/desktop && npm run dev
```

Navigate to Planner — the full planner view should render (not a Placeholder). Navigate to Notes — MarkdownViewer should render. Both should be fully functional.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): wire PlannerView and MarkdownViewer into nav"
```

---

## Post-Implementation Check

After all tasks complete, verify:

1. **Web** — Planner loads, DOCX export works, no console errors
2. **App** — Planner loads, Quick Capture FAB appears on phone, DOCX export works, `window.NexusMDNav` navigation from Calendar still works
3. **Desktop** — Planner nav entry visible, Planner renders, Notes nav entry visible, MarkdownViewer renders
4. **No data regression** — Existing planner weeks (both `nexusmd.planner.week.*` on web and `helm.planner.week.*` on app) load correctly after migration
