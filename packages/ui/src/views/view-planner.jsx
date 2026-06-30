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

const PlannerViewMemo = React.memo(PlannerView)
export { PlannerViewMemo as PlannerView }
