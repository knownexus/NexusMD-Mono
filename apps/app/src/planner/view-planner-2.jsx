import React from 'react';
import { Icon } from '../icons.jsx';
import { Sheet, helmPushPref } from '../components.jsx';
// view-planner-2.jsx — Weekly planner v2, part 2: modals, calendar picker, PlannerView.
// Load AFTER view-planner.jsx (part 1 defines DOCX/storage/confidential helpers + sections).

import {
  useStatePL, useEffectPL, useMemoPL, useRefPL, useCallbackPL,
  PLANNER_SECTIONS, PL_GROUPS, PLANNER_MIGRATION_FLAG,
  getIsoYearWeek, getIsoWeek, getYearWeekForOffset, getMondayOfDate,
  weekStorageKey, loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner,
  getWeeksWithData, weekKeyToOffset, fmtDateShort, plSectionGroup,
  loadVersions, saveVersions, describeSnapshot, buildEmptyPlannerData,
  hasMeaningfulPlannerData, isLegacyMigrationDone, markLegacyMigrationDone,
  plannerExportDocx,
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
  loadConfidentialConfig, saveConfidentialConfig, checkConfidentialReminders,
} from './view-planner.jsx';
import { PL_OPEN, plIsOverdueYmd, PlModal, PlFld, plNewRow, plScrollToEl } from './planner-ui.jsx';
import { WorkItemCtxLayer, GlobalNotesView } from './planner-notes.jsx';
import { SectionCard } from './planner-editors.jsx';
import { GlanceView, CarryOverModal } from './planner-glance.jsx';
import {
  ImportModal, VersionsModal, ConfidentialSetPasswordModal, ConfidentialUnlockModal,
  WeekCalendarPicker, PlHeaderMenu, PlMenuItem, PlMenuRadio, DeleteWeekModal,
} from '@nexusmd/ui';

// ── PlannerView ───────────────────────────────────────────────
function PlannerView({ data, setData, themes, setThemes }) {
  // Phone detection — rail layout (196px sidebar) is too cramped on phone
  const [isPhone, setIsPhone] = useStatePL(() => window.matchMedia('(max-width:600px)').matches);
  useEffectPL(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const handler = e => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // View prefs (persisted + synced)
  const [navMode, setNavMode] = useStatePL(() => {
    const stored = localStorage.getItem('helm.planner.nav');
    if (stored) return stored;
    return window.matchMedia('(max-width:600px)').matches ? 'tabs' : 'rail';
  });
  const [entryMode, setEntryMode] = useStatePL(() => {
    const stored = localStorage.getItem('helm.planner.entry');
    if (stored) return stored;
    return window.matchMedia('(max-width:600px)').matches ? 'quickadd' : 'inline';
  });
  // On phone, rail is unusable (196px sidebar leaves too little content width); use tabs instead
  const effectiveNavMode = isPhone && navMode === 'rail' ? 'tabs' : navMode;
  useEffectPL(() => { localStorage.setItem('helm.planner.nav', navMode); helmPushPref?.('helm.planner.nav', navMode); }, [navMode]);
  useEffectPL(() => { localStorage.setItem('helm.planner.entry', entryMode); helmPushPref?.('helm.planner.entry', entryMode); }, [entryMode]);

  const [activeGroup, setActiveGroup] = useStatePL(() => {
    // Landing-view pref (Settings → Planner): glance overview or straight to sections
    const landing = localStorage.getItem('helm.planner.landing') || 'glance';
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
  const [captureOpen, setCaptureOpen] = useStatePL(false);
  const [captureType, setCaptureType] = useStatePL(null);
  const [captureText, setCaptureText] = useStatePL('');
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
  const saveTimer = useRefPL(null);
  const latestRef = useRefPL({ data, themes, weekOffset });

  // Keep latestRef current so the unmount cleanup below can read the latest values.
  useEffectPL(() => { latestRef.current = { data, themes, weekOffset }; });

  // Flush any pending debounced save immediately on unmount. Without this, navigating
  // away and back within 600ms causes the remount to load stale per-week storage and
  // overwrite the in-memory edits that hadn't been written yet.
  useEffectPL(() => {
    return () => {
      clearTimeout(saveTimer.current);
      if (!readyToSave.current) return;
      const { data: d, themes: t, weekOffset: wo } = latestRef.current;
      const { year, week } = getYearWeekForOffset(wo);
      if (hasMeaningfulPlannerData(d, t)) {
        saveWeekPlanner(year, week, d, t);
      }
    };
  }, []);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 2600); };

  // Consume pending navigation set by navigateToPlanner (Calendar "Open in Planner" etc.)
  useEffectPL(() => {
    const nav = window.HelmNav;
    if (nav?.view === 'planner') {
      if (nav.pendingFilter) {
        const g = plSectionGroup(nav.pendingFilter);
        if (g) setActiveGroup(g.id);
        setTimeout(() => plScrollToEl('sec-' + nav.pendingFilter), 80);
      }
      if (nav.notification) setPendingNotification(nav.notification);
      window.HelmNav = null;
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

  // Re-hydrate planner / notes in-place when a cloud sync applies merged data.
  useEffectPL(() => {
    const handler = (e) => {
      const collId = e.detail?.collId;
      if (collId === 'planner') {
        setPlannerSyncRev(r => r + 1); // re-runs the week-load effect below
      } else if (collId === 'notes') {
        setGNotesRaw(loadGlobalNotes()); // read fresh; don't re-save
      }
    };
    document.addEventListener('nexusmd:sync-applied', handler);
    return () => document.removeEventListener('nexusmd:sync-applied', handler);
  }, []);

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

  // Auto-save per week — debounced 600ms so rapid edits don't block the main thread
  // with repeated synchronous localStorage writes on every keystroke.
  useEffectPL(() => {
    if (!readyToSave.current) return;
    clearTimeout(saveTimer.current);
    const { year, week } = getYearWeekForOffset(weekOffset);
    saveTimer.current = setTimeout(() => {
      if (hasMeaningfulPlannerData(data, themes)) {
        saveWeekPlanner(year, week, data, themes);
      } else {
        try { localStorage.removeItem(weekStorageKey(year, week)); } catch {}
      }
      setWeeksWithData(getWeeksWithData());
    }, 600);
  }, [data, themes]);

  // ── Carry-over ──
  const prevWeekData = useMemoPL(() => {
    const { year, week } = getYearWeekForOffset(weekOffset - 1);
    return loadWeekPlanner(year, week);
  }, [weekOffset, weeksWithData]);
  const carryItems = useMemoPL(() => collectCarryItems(prevWeekData?.data, PLANNER_SECTIONS), [prevWeekData]);
  // Carry-over prompt can be switched off in Settings → Planner
  const carryPromptEnabled = (localStorage.getItem('helm.planner.carryPrompt') || '1') !== '0';
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
    helmPushPref?.(key, null);
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
    const dismissKey = 'helm.planner.reminderDismissed';
    const dismissed = new Set();
    try { JSON.parse(localStorage.getItem(dismissKey) || '[]').forEach(k => dismissed.add(k)); } catch {}
    dismissed.add(first.rowId + ':' + first.reminderDate);
    try { localStorage.setItem(dismissKey, JSON.stringify([...dismissed])); } catch {}
    setDueReminders(prev => prev.slice(1));
  }, [dueReminders]);

  const handleDismissReminders = useCallbackPL(() => {
    const dismissKey = 'helm.planner.reminderDismissed';
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

  const handleCaptureSave = () => {
    const text = captureText.trim();
    if (!text || !captureType) return;
    if (captureType === 'note') {
      setGNotes(prev => [...prev, { id: 'n' + Date.now(), text, status: 'open', createdAt: new Date().toISOString() }]);
    } else {
      const secMap = { task: ['tasks', 'task'], meeting: ['meetSched', 'meeting'], wi: ['workItemsPlan', 'title'] };
      const [secId, field] = secMap[captureType];
      const sec = PLANNER_SECTIONS.find(s => s.id === secId);
      const extra = captureType === 'task' ? { priority: '3 - Medium' } : {};
      setData(d => {
        const base = isNewWeek ? buildEmptyPlannerData() : { ...d };
        base[secId] = [...(base[secId] || []), plNewRow(sec, { [field]: text, ...extra })];
        return base;
      });
      if (isNewWeek) { setThemes({}); setIsNewWeek(false); }
    }
    showFlash('Captured.');
    setCaptureOpen(false);
    setCaptureText('');
    setCaptureType(null);
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
    <div key={'h' + g.id} id={'grp-' + g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 10px', scrollMarginTop: 16 }}>
      <span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name={g.icon} size={14}/></span>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }}></span>
    </div>
  );

  const openGroup = (gid) => {
    setActiveGroup(gid);
    if (effectiveNavMode === 'scroll') setTimeout(() => plScrollToEl('grp-' + gid), 30);
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

  // Pre-compute nav rail counts/alerts once per render rather than inside the map loop.
  const navStats = useMemoPL(() => {
    const stats = {};
    navGroups.forEach(g => {
      if (!g.ids) return;
      let counts = 0;
      let hasAlert = false;
      const secLockedHere = g.ids.some(id => confCfg.sections.includes(id) && !unlockedSections.has(id));
      g.ids.forEach(id => {
        const sec = PLANNER_SECTIONS.find(s => s.id === id);
        if (!sec || sec.type !== 'table') return;
        const rows = data[id] || [];
        const dc = sec.cols.find(c => c.t === 'date');
        rows.forEach(r => {
          if (!rowVisible(sec, r)) return;
          if (PL_OPEN(r.status || '')) counts++;
          if (!hasAlert && (r.status === 'Blocked' || (dc && plIsOverdueYmd(r[dc.k], r.status)))) hasAlert = true;
        });
      });
      stats[g.id] = { counts, hasAlert, secLockedHere };
    });
    return stats;
  }, [data, confCfg, unlockedSections, rowVisible]);

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
    <div className="m-appbar">
      <div className="m-ab-lead">
        <h1>Planner</h1>
        <div className="m-ab-sub">{weekLabel.full}</div>
      </div>
      <div className="m-ab-actions">
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
            <button type="button" className="btn sm ghost" onClick={() => setWeekOffset(0)} title="Go to current week"
              style={{ fontSize:11 }}>Today</button>
          )}
          {calendarOpen && (
            <WeekCalendarPicker weekOffset={weekOffset} onSelectOffset={setWeekOffset}
              weeksWithData={weeksWithData} onClose={() => setCalendarOpen(false)}/>
          )}
        </div>
        {lockedCount > 0 && (
          <button type="button" className="m-iconbtn" title={`${lockedCount} locked`}
            onClick={() => { setPendingUnlockSectionId(null); setModal('unlock'); }}>
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
                <PlMenuItem icon="inbox" label="Import JSON…" onClick={() => { close(); setModal('import'); }}/>
                <PlMenuItem icon="send" label="Export JSON" onClick={() => { close(); exportJson(); }}/>
                <PlMenuItem icon="send" label="Export Word (.docx)" onClick={() => { close(); plannerExportDocx(data, themes, new Date().toISOString().slice(0,10)); }}/>
                <div style={{ height:1, background:'var(--border)', margin:'3px 6px' }}/>
                <PlMenuItem icon="clock" label="Versions…" onClick={() => { close(); setModal('versions'); }}/>
                <div style={{ height:1, background:'var(--border)', margin:'3px 6px' }}/>
                <PlMenuItem icon="trash" label="Delete week…" danger onClick={() => { close(); setModal('delete-week'); }}/>
              </React.Fragment>
            )}
          </PlHeaderMenu>
        )}
      </div>
    </div>
  );

  // ── Empty week ──
  if (isNewWeek) {
    return (
      <React.Fragment>
        {header}
        <div className="m-screen">
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
        </div>
        {modals}
      </React.Fragment>
    );
  }

  const captureTypeOptions = [
    { id:'note', label:'Note', icon:'edit' },
    { id:'task', label:'Task', icon:'check' },
    { id:'meeting', label:'Meeting', icon:'planner' },
    { id:'wi', label:'Work Item', icon:'work' },
  ];
  const capturePlaceholders = { note:'Quick note…', task:'Task title…', meeting:'Meeting name…', wi:'Work item title…' };

  return (
    <React.Fragment>
      {header}

      {/* Scroll mode: chipnav lives outside m-screen so it's always visible and
          flush against the appbar — no sticky/float weirdness inside the scroll area */}
      {effectiveNavMode === 'scroll' && (
        <div className="pl-chipnav" style={{
          position: 'relative', zIndex: 5,
          borderBottom: '1px solid var(--border)',
          padding: '8px 14px', margin: 0,
        }}>
          {navGroups.map(g => (
            <button key={g.id} className={`pl-chip ${activeGroup === g.id ? 'active' : ''}`}
              onClick={() => { setActiveGroup(g.id); plScrollToEl('grp-' + g.id); }}>
              <Icon name={g.icon} size={12}/>{g.label}
            </button>
          ))}
        </div>
      )}

      <div className="m-screen">
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
                const { counts = 0, hasAlert = false, secLockedHere = false } = navStats[g.id] || {};
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
      </div>

      <button type="button" className="m-fab" onClick={() => setCaptureOpen(true)} aria-label="Quick capture">
        <Icon name="plus" size={24}/>
      </button>

      <Sheet open={captureOpen} icon="plus" title="Quick capture"
        onClose={() => { setCaptureOpen(false); setCaptureText(''); setCaptureType(null); }}>
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
              onKeyDown={e => { if (e.key === 'Enter') handleCaptureSave(); }}
              placeholder={capturePlaceholders[captureType] || 'Enter text…'}
              style={{ padding:'10px 12px', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface-2)', font:'inherit', fontSize:15, color:'var(--text)', outline:'none' }}/>
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" className="btn ghost m-btn-lg" onClick={() => setCaptureType(null)}>Back</button>
              <button type="button" className="btn primary m-btn-lg" style={{ flex:1 }} onClick={handleCaptureSave}>Add</button>
            </div>
          </div>
        )}
      </Sheet>

      {modals}
    </React.Fragment>
  );
}

// Memoized so App's 1-second autoRefreshLeft tick doesn't cascade through the full planner tree.
const PlannerViewMemo = React.memo(PlannerView);
export { PlannerViewMemo as PlannerView };
window.helmConfidential = { hashPassword, loadConfidentialConfig, saveConfidentialConfig };


