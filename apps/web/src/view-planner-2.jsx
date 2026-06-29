import React from 'react';
import { NotificationBanner, nexusMDPushPref } from './components.jsx';
import { Icon } from './icons.jsx';
import { plScrollToEl, plNewRow, PL_OPEN, plIsOverdueYmd } from './planner-ui.jsx';
import { WorkItemCtxLayer, GlobalNotesView, loadGlobalNotes, saveGlobalNotes } from './planner-notes.jsx';
import { SectionCard } from './planner-editors.jsx';
import { GlanceView, collectCarryItems, CarryOverModal } from './planner-glance.jsx';
import { loadConfidentialConfig, saveConfidentialConfig } from './confidential.jsx';
import {
  ImportModal, VersionsModal, ConfidentialSetPasswordModal, ConfidentialUnlockModal,
  WeekCalendarPicker, PlHeaderMenu, PlMenuItem, PlMenuRadio, DeleteWeekModal,
} from '@nexusmd/ui';
import {
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup, getIsoWeek, fmtDateShort,
  getYearWeekForOffset, weekStorageKey, loadWeekPlanner, saveWeekPlanner,
  getWeeksWithData, isLegacyMigrationDone, markLegacyMigrationDone, hasMeaningfulPlannerData,
  buildEmptyPlannerData, checkConfidentialReminders, plannerExportDocx,
} from './view-planner.jsx';

// view-planner-2.jsx — Weekly planner v2, part 2: modals, calendar picker, PlannerView.
// Load AFTER view-planner.jsx (part 1 defines DOCX/storage/sections/helpers).

const { useState: useStatePL, useEffect: useEffectPL, useMemo: useMemoPL, useRef: useRefPL, useCallback: useCallbackPL } = React;

// ── PlannerView ───────────────────────────────────────────────
export function PlannerView({ data, setData, themes, setThemes }) {
  // View prefs (persisted + synced)
  const [navMode, setNavMode] = useStatePL(() => localStorage.getItem('nexusmd.planner.nav') || 'rail');
  const [entryMode, setEntryMode] = useStatePL(() => localStorage.getItem('nexusmd.planner.entry') || 'inline');
  useEffectPL(() => { localStorage.setItem('nexusmd.planner.nav', navMode); nexusMDPushPref?.('nexusmd.planner.nav', navMode); }, [navMode]);
  useEffectPL(() => { localStorage.setItem('nexusmd.planner.entry', entryMode); nexusMDPushPref?.('nexusmd.planner.entry', entryMode); }, [entryMode]);

  const [activeGroup, setActiveGroup] = useStatePL(() => {
    // Landing-view pref (Settings → Planner): glance overview or straight to sections
    const landing = localStorage.getItem('nexusmd.planner.landing') || 'glance';
    const initial = landing === 'sections' ? PL_GROUPS[0].id : 'overview';
    return initial;
  });
  const [weekOffset, setWeekOffset] = useStatePL(0);
  const [modal, setModal] = useStatePL(null); // 'import'|'versions'|'setpw'|'unlock'|'carry'|'delete-week'
  const [flash, setFlash] = useStatePL(null);
  const [calendarOpen, setCalendarOpen] = useStatePL(false);
  const [weeksWithData, setWeeksWithData] = useStatePL(() => getWeeksWithData());
  const [isNewWeek, setIsNewWeek] = useStatePL(false);
  const [pendingNotification, setPendingNotification] = useStatePL(null);
  const [dueReminders, setDueReminders] = useStatePL([]);
  const [highlightedRowId, setHighlightedRowId] = useStatePL(null);
  const [carryDismissed, setCarryDismissed] = useStatePL(false);
  // Confidential
  const [confCfg, setConfCfg] = useStatePL(() => loadConfidentialConfig());
  const [unlockedSections, setUnlockedSections] = useStatePL(() => new Set());
  const [pendingUnlockSectionId, setPendingUnlockSectionId] = useStatePL(null);
  const [pendingMark, setPendingMark] = useStatePL(null);
  const [pendingMarkRow, setPendingMarkRow] = useStatePL(null);
  // Week-agnostic notes
  const [gNotes, setGNotesRaw] = useStatePL(() => loadGlobalNotes());
  const setGNotes = useCallbackPL((fn) => setGNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    saveGlobalNotes(next);
    return next;
  }), []);

  // Bumped when a cloud sync writes new planner week data so the week-load
  // effect re-runs and pulls the merged data from localStorage.
  const [plannerSyncRev, setPlannerSyncRev] = useStatePL(0);

  const calendarRef = useRefPL(null);
  const isFirstLoad = useRefPL(true);
  const readyToSave = useRefPL(false);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 2600); };

  // Listen for nexusmd:sync-applied and re-hydrate planner / notes in-place.
  useEffectPL(() => {
    const handler = (e) => {
      const collId = e.detail?.collId;
      if (collId === 'planner') {
        // Bump the sync revision counter — added to the week-load effect deps below,
        // so the current week's data is re-read from localStorage without a page reload.
        setPlannerSyncRev(r => r + 1);
      } else if (collId === 'notes') {
        // Direct state update: just read the fresh value; do not call setGNotes
        // (which also saves back to localStorage and would trigger a redundant write).
        setGNotesRaw(loadGlobalNotes());
      }
    };
    document.addEventListener('nexusmd:sync-applied', handler);
    return () => document.removeEventListener('nexusmd:sync-applied', handler);
  }, []);

  // Consume pending navigation set by navigateToPlanner (Calendar "Open in Planner" etc.)
  useEffectPL(() => {
    const nav = window.NexusMDNav;
    if (nav?.view === 'planner') {
      if (nav.pendingFilter) {
        const g = plSectionGroup(nav.pendingFilter);
        if (g) setActiveGroup(g.id);
        setTimeout(() => plScrollToEl('sec-' + nav.pendingFilter), 80);
      }
      if (nav.notification) setPendingNotification(nav.notification);
      window.NexusMDNav = null;
    }
  }, []);

  // Check for due reminders on confidential entries
  useEffectPL(() => {
    const due = checkConfidentialReminders();
    if (due.length > 0) setDueReminders(due);
  }, []);

  // Close calendar on outside click
  useEffectPL(() => {
    if (!calendarOpen) return;
    const onDoc = e => { if (calendarRef.current && !calendarRef.current.contains(e.target)) setCalendarOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [calendarOpen]);

  // Load per-week data whenever the active week changes (v1 logic incl. migration)
  useEffectPL(() => {
    readyToSave.current = false;
    const { year, week } = getYearWeekForOffset(weekOffset);
    const saved = loadWeekPlanner(year, week);

    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        setData(d => ({ ...d, ...saved.data }));
        if (saved.themes) setThemes(t => ({ ...t, ...saved.themes }));
        setIsNewWeek(false);
      } else if (!saved && hasMeaningfulPlannerData(data, themes)
                 && !isLegacyMigrationDone() && getWeeksWithData().size === 0) {
        saveWeekPlanner(year, week, data, themes);
        markLegacyMigrationDone();
        setWeeksWithData(getWeeksWithData());
        setIsNewWeek(false);
      } else {
        markLegacyMigrationDone();
        setData({});
        setThemes({});
        setIsNewWeek(true);
      }
    } else {
      if (saved && saved.data && Object.keys(saved.data).length > 0) {
        const newData = buildEmptyPlannerData();
        for (const sec of PLANNER_SECTIONS) {
          if (saved.data[sec.id] != null) newData[sec.id] = saved.data[sec.id];
        }
        if (saved.data._carriedOver) newData._carriedOver = true;
        setData(newData);
        setThemes(saved.themes || {});
        setIsNewWeek(false);
      } else {
        setData({});
        setThemes({});
        setIsNewWeek(true);
      }
    }
    setCarryDismissed(false);
    setTimeout(() => { readyToSave.current = true; }, 60);
  }, [weekOffset, plannerSyncRev]);

  // Auto-save per week
  useEffectPL(() => {
    if (!readyToSave.current) return;
    const { year, week } = getYearWeekForOffset(weekOffset);
    if (hasMeaningfulPlannerData(data, themes)) {
      saveWeekPlanner(year, week, data, themes);
    } else {
      try { localStorage.removeItem(weekStorageKey(year, week)); } catch {}
    }
    setWeeksWithData(getWeeksWithData());
  }, [data, themes]);

  // ── Carry-over ──
  const prevWeekData = useMemoPL(() => {
    const { year, week } = getYearWeekForOffset(weekOffset - 1);
    return loadWeekPlanner(year, week);
  }, [weekOffset, weeksWithData]);
  const carryItems = useMemoPL(() => collectCarryItems(prevWeekData?.data, PLANNER_SECTIONS), [prevWeekData]);
  // Carry-over prompt can be switched off in Settings → Planner
  const carryPromptEnabled = (localStorage.getItem('nexusmd.planner.carryPrompt') || '1') !== '0';
  const showCarryBanner = carryPromptEnabled && !isNewWeek && carryItems.length > 0 && !data._carriedOver && !carryDismissed;

  const handleCarry = (selected) => {
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d };
      selected.forEach(i => {
        const arr = (base[i.section.id] || []).slice();
        arr.push({ ...i.row, id: 'co' + Date.now() + Math.random().toString(36).slice(2, 5) });
        base[i.section.id] = arr;
      });
      base._carriedOver = true;
      return base;
    });
    if (isNewWeek) { setThemes({}); setIsNewWeek(false); }
    setModal(null);
    showFlash(`Carried over ${selected.length} item${selected.length !== 1 ? 's' : ''} from last week.`);
  };

  const handleCreateEntry = () => {
    setData(buildEmptyPlannerData());
    setThemes({});
    setIsNewWeek(false);
  };

  // ── Confidential handlers (v1) ──
  const handleMarkConfidential = (sectionId) => {
    if (!confCfg.hash) { setPendingMark(sectionId); setModal('setpw'); }
    else {
      const newCfg = { ...confCfg, sections: [...confCfg.sections, sectionId] };
      setConfCfg(newCfg); saveConfidentialConfig(newCfg);
    }
  };
  const handleRemoveConfidential = (sectionId) => {
    const newCfg = { ...confCfg, sections: confCfg.sections.filter(id => id !== sectionId) };
    setConfCfg(newCfg); saveConfidentialConfig(newCfg);
  };
  const handleLockRow = (sectionId, rowId) => {
    if (!confCfg.hash) { setPendingMarkRow({ sectionId, rowId }); setModal('setpw'); }
    else setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }));
  };
  const handleUnlockRow = (sectionId, rowId) => {
    setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: false } : r) }));
  };
  const handlePasswordSaved = (hash) => {
    const newCfg = { hash, sections: pendingMark ? [...confCfg.sections, pendingMark] : confCfg.sections };
    setConfCfg(newCfg); saveConfidentialConfig(newCfg);
    setPendingMark(null);
    if (pendingMarkRow) {
      const { sectionId, rowId } = pendingMarkRow;
      setData(d => ({ ...d, [sectionId]: (d[sectionId] || []).map(r => r.id === rowId ? { ...r, _confidential: true } : r) }));
      setPendingMarkRow(null);
    }
  };

  const weekLabel = useMemoPL(() => {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1 + weekOffset * 7);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const wk = getIsoWeek(monday);
    return { short: `W${wk}`, full: `Week ${wk} · ${fmtDateShort(monday)} - ${fmtDateShort(sunday)}` };
  }, [weekOffset]);

  const { year: cYear, week: cWeek } = getYearWeekForOffset(weekOffset);
  const currentHasData = weeksWithData.has(`${cYear}-W${String(cWeek).padStart(2, '0')}`);
  const lockedRowCount = useMemoPL(() => PLANNER_SECTIONS.reduce((n, s) =>
    n + (s.type === 'table' ? (data[s.id] || []).filter(r => r._confidential && !unlockedSections.has(s.id)).length : 0), 0), [data, unlockedSections]);
  const lockedCount = confCfg.sections.filter(id => !unlockedSections.has(id)).length + lockedRowCount;

  const exportJson = () => {
    const payload = { data, themes, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const handleImport = (importedData, importedThemes) => {
    if (importedData && typeof importedData === 'object') setData(d => ({ ...d, ...importedData }));
    if (importedThemes && typeof importedThemes === 'object') setThemes(t => ({ ...t, ...importedThemes }));
    if (isNewWeek) setIsNewWeek(false);
    showFlash('Imported successfully.');
  };
  const handleRestore = (restoredData, restoredThemes) => {
    if (restoredData && typeof restoredData === 'object') setData(d => ({ ...d, ...restoredData }));
    if (restoredThemes && typeof restoredThemes === 'object') setThemes(t => ({ ...t, ...restoredThemes }));
    if (isNewWeek) setIsNewWeek(false);
    showFlash('Snapshot restored.');
  };
  const handleDeleteWeek = () => {
    const { year, week } = getYearWeekForOffset(weekOffset);
    const key = weekStorageKey(year, week);
    try { localStorage.removeItem(key); } catch {}
    nexusMDPushPref?.(key, null);
    setData({});
    setThemes({});
    setIsNewWeek(true);
    setWeeksWithData(getWeeksWithData());
    showFlash(`${weekLabel.short} deleted.`);
  };

  const handleViewNotification = useCallbackPL(() => {
    if (!pendingNotification) return;
    const { sectionId, personName, date } = pendingNotification;
    const g = plSectionGroup(sectionId);
    if (g) setActiveGroup(g.id);
    setTimeout(() => plScrollToEl('sec-' + sectionId), 80);
    if (sectionId === 'oneOnOnes') {
      const row = (data.oneOnOnes || []).find(
        r => r.person?.toLowerCase() === (personName || '').toLowerCase() && r.date === date
      );
      if (row) {
        setHighlightedRowId(row.id);
        setTimeout(() => setHighlightedRowId(null), 2500);
      }
    }
    setPendingNotification(null);
  }, [pendingNotification, data]);

  const handleViewReminder = useCallbackPL(() => {
    if (!dueReminders.length) return;
    const first = dueReminders[0];
    if (first.weekOffset !== 0) setWeekOffset(first.weekOffset);
    const g = plSectionGroup(first.sectionId);
    if (g) setActiveGroup(g.id);
    setTimeout(() => plScrollToEl('sec-' + first.sectionId), 100);
    setHighlightedRowId(first.rowId);
    setTimeout(() => setHighlightedRowId(null), 2500);
    const dismissKey = 'nexusmd.planner.reminderDismissed';
    const dismissed = new Set();
    try { JSON.parse(localStorage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)); } catch {}
    dismissed.add(first.rowId + ':' + first.reminderDate);
    try { localStorage.setItem(dismissKey, JSON.stringify([...dismissed])); } catch {}
    setDueReminders(prev => prev.slice(1));
  }, [dueReminders]);

  const handleDismissReminders = useCallbackPL(() => {
    const dismissKey = 'nexusmd.planner.reminderDismissed';
    const dismissed = new Set();
    try { JSON.parse(localStorage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)); } catch {}
    dueReminders.forEach(r => dismissed.add(r.rowId + ':' + r.reminderDate));
    try { localStorage.setItem(dismissKey, JSON.stringify([...dismissed])); } catch {}
    setDueReminders([]);
  }, [dueReminders]);

  // Glance visibility: hide locked sections + locked rows
  const rowVisible = useCallbackPL((sec, row) => {
    if (!sec) return false;
    if (confCfg.sections.includes(sec.id) && !unlockedSections.has(sec.id)) return false;
    if (row._confidential && !unlockedSections.has(sec.id)) return false;
    return true;
  }, [confCfg, unlockedSections]);

  // Global notes → "Task this week"
  const addTaskFromNote = (title) => {
    const sec = PLANNER_SECTIONS.find(s => s.id === 'tasks');
    setData(d => {
      const base = isNewWeek ? buildEmptyPlannerData() : { ...d };
      base.tasks = [...(base.tasks || []), plNewRow(sec, { task: title, priority: '3 - Medium' })];
      return base;
    });
    if (isNewWeek) { setThemes({}); setIsNewWeek(false); }
    showFlash(`Added as a task in ${weekLabel.short}.`);
  };

  const sectionProps = (sectionId) => ({
    isConfidential: confCfg.sections.includes(sectionId),
    sessionUnlocked: unlockedSections.has(sectionId),
    onMarkConfidential:   () => handleMarkConfidential(sectionId),
    onRemoveConfidential: () => handleRemoveConfidential(sectionId),
    onUnlockRequest:      () => { setPendingUnlockSectionId(sectionId); setModal('unlock'); },
    onLockRow:   (rowId) => handleLockRow(sectionId, rowId),
    onUnlockRow: (rowId) => handleUnlockRow(sectionId, rowId),
  });

  const renderSection = (sec) => (
    <SectionCard key={sec.id} section={sec} data={data} setData={setData} themes={themes} setThemes={setThemes}
      entryStyle={entryMode} domId={'sec-' + sec.id}
      highlightedRowId={highlightedRowId}
      meetingOptions={sec.id === 'meetNotes' ? (data.meetSched || []) : null}
      {...sectionProps(sec.id)}/>
  );

  const groupHeader = (g) => (
    <div key={'h' + g.id} id={'grp-' + g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 10px', scrollMarginTop: 64 }}>
      <span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={g.icon} size={14}/></span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }}></span>
    </div>
  );

  const openGroup = (gid) => {
    setActiveGroup(gid);
    if (navMode === 'scroll') setTimeout(() => plScrollToEl('grp-' + gid), 30);
  };
  const openSection = (sid) => {
    const g = plSectionGroup(sid);
    setActiveGroup(g ? g.id : 'overview');
    setTimeout(() => plScrollToEl('sec-' + sid), 80);
  };

  const openNotesCount = gNotes.filter(n => n.status !== 'done').length;
  const navGroups = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'mynotes', label: 'Notes', icon: 'pin' },
    ...PL_GROUPS,
  ];

  const glance = (
    <GlanceView data={data} themes={themes} sections={PLANNER_SECTIONS} groups={PL_GROUPS}
      onOpenGroup={openGroup} onOpenSection={openSection} rowVisible={rowVisible}
      carryCount={showCarryBanner ? carryItems.length : 0} onOpenCarry={() => setModal('carry')}/>
  );
  const notesView = (
    <GlobalNotesView notes={gNotes} setNotes={setGNotes} weekLabel={weekLabel.short} onAddTask={addTaskFromNote}/>
  );

  const modals = (
    <React.Fragment>
      <ImportModal open={modal === 'import'} onClose={() => setModal(null)} onImport={handleImport}/>
      <VersionsModal open={modal === 'versions'} onClose={() => setModal(null)} currentData={data} currentThemes={themes} onRestore={handleRestore}/>
      <ConfidentialSetPasswordModal
        open={modal === 'setpw'} existingHash={confCfg.hash}
        onClose={() => { setModal(null); setPendingMark(null); setPendingMarkRow(null); }}
        onSaved={handlePasswordSaved}/>
      <ConfidentialUnlockModal
        open={modal === 'unlock'} onClose={() => setModal(null)}
        onUnlocked={() => {
          const latestCfg = loadConfidentialConfig();
          setConfCfg(latestCfg);
          if (pendingUnlockSectionId !== null) {
            setUnlockedSections(prev => new Set([...prev, pendingUnlockSectionId]));
          } else {
            setUnlockedSections(new Set([...latestCfg.sections, ...PLANNER_SECTIONS.map(s => s.id)]));
          }
          setPendingUnlockSectionId(null);
        }}/>
      <CarryOverModal open={modal === 'carry'} onClose={() => { setModal(null); setCarryDismissed(true); }}
        items={carryItems} prevLabel={`W${getYearWeekForOffset(weekOffset - 1).week}`} onCarry={handleCarry}/>
      <DeleteWeekModal open={modal === 'delete-week'} onClose={() => setModal(null)}
        weekLabel={weekLabel} onConfirm={handleDeleteWeek}/>
      <WorkItemCtxLayer/>
    </React.Fragment>
  );

  // ── Header ──
  const header = (
    <div className="page-head">
      <div>
        <h1>Weekly planner</h1>
        <div className="sub">{weekLabel.full} · personal running notes</div>
      </div>
      <div className="page-head-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 2, position: 'relative' }} ref={calendarRef}>
          <button className="btn icon ghost sm" onClick={() => setWeekOffset(w => w - 1)} title="Previous week"><Icon name="chevron-left" size={13}/></button>
          <button className="btn sm ghost" onClick={() => setCalendarOpen(o => !o)} title="Choose a week"
            style={{ fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px' }}>
            {weekLabel.short}
            {currentHasData && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--success)' }} title="This week has saved data"></span>}
          </button>
          <button className="btn icon ghost sm" onClick={() => setWeekOffset(w => w + 1)} title="Next week"><Icon name="chevron-right" size={13}/></button>
          {calendarOpen && (
            <WeekCalendarPicker weekOffset={weekOffset} onSelectOffset={setWeekOffset}
              weeksWithData={weeksWithData} onClose={() => setCalendarOpen(false)}/>
          )}
        </div>
        {weekOffset !== 0 && <button className="btn sm ghost" onClick={() => setWeekOffset(0)}>This week</button>}

        {lockedCount > 0 && (
          <button className="btn sm ghost" onClick={() => { setPendingUnlockSectionId(null); setModal('unlock'); }} title="Unlock all confidential sections"
            style={{ color: 'var(--text-subtle)' }}>
            <Icon name="lock" size={13}/> {lockedCount} locked
          </button>
        )}
        {unlockedSections.size > 0 && (
          <button className="btn sm ghost" onClick={() => setUnlockedSections(new Set())} title="Re-lock all confidential sections"
            style={{ color: 'var(--accent)' }}>
            <Icon name="lock" size={13}/> Re-lock
          </button>
        )}

        {!isNewWeek && (
          <React.Fragment>
            <PlHeaderMenu label="View" icon="board">
              {() => (
                <React.Fragment>
                  <PlMenuRadio heading="Navigation" value={navMode}
                    options={[['rail', 'Rail'], ['scroll', 'Scroll'], ['tabs', 'Tabs']]} onChange={setNavMode}/>
                  <PlMenuRadio heading="Entry style" value={entryMode}
                    options={[['inline', 'Inline'], ['quickadd', 'Quick-add'], ['drawer', 'Drawer']]} onChange={setEntryMode}/>
                </React.Fragment>
              )}
            </PlHeaderMenu>
            <PlHeaderMenu label="Data" icon="inbox">
              {(close) => (
                <React.Fragment>
                  <PlMenuItem icon="inbox" label="Import JSON…" onClick={() => { close(); setModal('import'); }}/>
                  <PlMenuItem icon="send" label="Export JSON" onClick={() => { close(); exportJson(); }}/>
                  <PlMenuItem icon="send" label="Export Word (.docx)" onClick={() => { close(); plannerExportDocx(data, themes, new Date().toISOString().slice(0, 10)); }}/>
                  <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }}></div>
                  <PlMenuItem icon="clock" label="Versions…" onClick={() => { close(); setModal('versions'); }}/>
                  <div style={{ height: 1, background: 'var(--border)', margin: '3px 6px' }}></div>
                  <PlMenuItem icon="trash" label="Delete this week…" danger onClick={() => { close(); setModal('delete-week'); }}/>
                </React.Fragment>
              )}
            </PlHeaderMenu>
          </React.Fragment>
        )}
      </div>
    </div>
  );

  // ── Empty week ──
  if (isNewWeek) {
    return (
      <div data-screen-label="Planner — empty week">
        {header}
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
        {modals}
      </div>
    );
  }

  return (
    <div data-screen-label="Planner">
      {header}

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

      {navMode === 'rail' && (
        <div className="pl-layout">
          <nav className="pl-rail">
            {navGroups.map(g => {
              const secLockedHere = g.ids && g.ids.some(id => confCfg.sections.includes(id) && !unlockedSections.has(id));
              const counts = (g.ids || []).reduce((n, id) => {
                const sec = PLANNER_SECTIONS.find(s => s.id === id);
                if (!sec || sec.type !== 'table') return n;
                return n + (data[id] || []).filter(r => PL_OPEN(r.status || '') && rowVisible(sec, r)).length;
              }, 0);
              const hasAlert = (g.ids || []).some(id => {
                const sec = PLANNER_SECTIONS.find(s => s.id === id);
                if (!sec || sec.type !== 'table') return false;
                const dc = sec.cols.find(c => c.t === 'date');
                return (data[id] || []).some(r => rowVisible(sec, r) && (r.status === 'Blocked' || (dc && plIsOverdueYmd(r[dc.k], r.status))));
              });
              return (
                <button key={g.id} className={`pl-rail-item ${activeGroup === g.id ? 'active' : ''}`} onClick={() => setActiveGroup(g.id)}>
                  <span className="ic"><Icon name={g.icon} size={14}/></span>
                  {g.label}
                  {g.id === 'mynotes' && openNotesCount > 0 && <span className="count">{openNotesCount}</span>}
                  {g.ids && (hasAlert ? <span className="dot-alert" title="Overdue or blocked items"></span>
                    : secLockedHere && counts === 0 ? <Icon name="lock" size={10} style={{ marginLeft: 'auto', opacity: .4 }}/>
                    : counts > 0 ? <span className="count">{counts}</span> : null)}
                </button>
              );
            })}
          </nav>
          <div style={{ minWidth: 0 }}>
            {activeGroup === 'overview' ? glance
              : activeGroup === 'mynotes' ? notesView
              : (PL_GROUPS.find(g => g.id === activeGroup) || PL_GROUPS[0]).ids.map(id => renderSection(PLANNER_SECTIONS.find(s => s.id === id)))}
          </div>
        </div>
      )}

      {navMode === 'scroll' && (
        <div>
          <div className="pl-chipnav">
            {navGroups.map(g => (
              <button key={g.id} className={`pl-chip ${activeGroup === g.id ? 'active' : ''}`}
                onClick={() => { setActiveGroup(g.id); plScrollToEl('grp-' + g.id); }}>
                <Icon name={g.icon} size={12}/>{g.label}
              </button>
            ))}
          </div>
          <div id="grp-overview" style={{ scrollMarginTop: 64, marginBottom: 8 }}>{glance}</div>
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

      {navMode === 'tabs' && (
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

      {modals}
    </div>
  );
}
