import JSZip from 'jszip';
import { nexusMDPushPref } from './components.jsx';
import { weekKey, PlannerSync } from './planner-sync.js';
// Pure planner schema + date helpers now live in @nexusmd/core (Phase 5).
// Re-exported here so existing `./view-planner.jsx` importers keep working.
import {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
} from '@nexusmd/core';
export {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
};

// view-planner.jsx — Weekly planner v2
// Redesign: glance overview, grouped navigation (rail/scroll/tabs), three entry
// styles (inline/quick-add/drawer), carry-over, multi-notes, week-agnostic notes.
// Preserved from v1: DOCX export, per-week storage + legacy migration, versions,
// confidential sections/rows (SHA-256 + AES-GCM sync), calendar picker,
// NexusMDNav navigation, nexusmd:create-wi context menu.
// Requires (load before this file): planner-ui.jsx, planner-notes.jsx,
// planner-editors.jsx, planner-glance.jsx, css/nexusmd-planner-v2.css.

// ── DOCX export helpers (unchanged from v1) ──────────────────
const _HD_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const NEXUSMD_DOCX_HEADING_MAP = {
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
};

function _hdGetText(el) { return Array.from(el.getElementsByTagName('w:t')).map(t => t.textContent).join(''); }
function _hdNorm(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }
function _hdDirectKids(el, tag) { return Array.from(el.childNodes).filter(n => n.tagName === tag); }
function _hdParaStyle(para) { const s = para.getElementsByTagName('w:pStyle')[0]; return s ? (s.getAttribute('w:val')||'Normal') : 'Normal'; }

function _hdSetParaText(xmlDoc, paraEl, text) {
  const pPr = paraEl.getElementsByTagName('w:pPr')[0] || null;
  while (paraEl.lastChild) paraEl.removeChild(paraEl.lastChild);
  if (pPr) paraEl.appendChild(pPr);
  if (text) {
    const r = xmlDoc.createElementNS(_HD_W_NS, 'w:r');
    const t = xmlDoc.createElementNS(_HD_W_NS, 'w:t');
    if (text.startsWith(' ') || text.endsWith(' ')) t.setAttribute('xml:space', 'preserve');
    t.textContent = text; r.appendChild(t); paraEl.appendChild(r);
  }
}

function _hdSetCellText(xmlDoc, tcEl, text) {
  const paras = _hdDirectKids(tcEl, 'w:p');
  if (paras.length) {
    _hdSetParaText(xmlDoc, paras[0], text);
    paras.slice(1).forEach(p => tcEl.removeChild(p));
  } else {
    const p = xmlDoc.createElementNS(_HD_W_NS, 'w:p');
    const r = xmlDoc.createElementNS(_HD_W_NS, 'w:r');
    const t = xmlDoc.createElementNS(_HD_W_NS, 'w:t');
    t.textContent = text; r.appendChild(t); p.appendChild(r); tcEl.appendChild(p);
  }
}

function _hdWriteTable(sec, tblEl, rows, xmlDoc, data) {
  if (!rows.length) return;
  const hN = _hdDirectKids(rows[0], 'w:tc').map(tc => _hdNorm(_hdGetText(tc)));
  const colIdx = {};
  sec.cols.forEach(c => { const idx = hN.findIndex(h => h === _hdNorm(c.l)); if (idx >= 0) colIdx[idx] = c.k; });
  const tmpl = rows.length > 1 ? rows[1] : rows[0];
  rows.slice(1).forEach(r => tblEl.removeChild(r));
  const dr = data[sec.id] || [];
  (dr.length ? dr : [null]).forEach(dataRow => {
    const newRow = tmpl.cloneNode(true);
    _hdDirectKids(newRow, 'w:tc').forEach((tc, ci) => {
      _hdSetCellText(xmlDoc, tc, dataRow && colIdx[ci] ? (dataRow[colIdx[ci]] || '') : '');
    });
    tblEl.appendChild(newRow);
  });
}

function _hdWriteSection(sec, kids, i, body, xmlDoc, data, themes) {
  while (i < kids.length && kids[i].tagName === 'w:p' && !_hdGetText(kids[i]).trim()) i++;
  const isHd = el => el.tagName === 'w:p' && _hdParaStyle(el).startsWith('Heading');

  if (sec.type === 'table') {
    while (i < kids.length) {
      const el = kids[i]; if (isHd(el)) break;
      if (el.tagName === 'w:tbl') {
        const rows = _hdDirectKids(el, 'w:tr');
        const hN = rows.length ? _hdDirectKids(rows[0], 'w:tc').map(tc => _hdNorm(_hdGetText(tc))) : [];
        const mc = sec.cols.filter(c => hN.some(h => h === _hdNorm(c.l))).length;
        i++; if (mc >= 2) { _hdWriteTable(sec, el, rows, xmlDoc, data); break; } continue;
      }
      i++;
    }
  } else if (sec.type === 'keyval') {
    const pe = [];
    while (i < kids.length) { const el = kids[i]; if (isHd(el) || el.tagName === 'w:tbl') break; if (el.tagName === 'w:p') pe.push(el); i++; }
    sec.fields.forEach((field, idx) => { if (idx < pe.length) _hdSetParaText(xmlDoc, pe[idx], field.l + ': ' + (themes[field.k] || '')); });
  } else if (sec.type === 'textarea') {
    const pe = [];
    while (i < kids.length) { const el = kids[i]; if (isHd(el) || el.tagName === 'w:tbl') break; if (el.tagName === 'w:p') pe.push(el); i++; }
    const text = data[sec.id] || '';
    if (pe.length) { _hdSetParaText(xmlDoc, pe[0], text); pe.slice(1).forEach(p => _hdSetParaText(xmlDoc, p, '')); }
  } else if (sec.type === 'eow') {
    const H3 = { 'what went well': 'well', 'what did not': 'didNot', 'carry forward to next week': 'carry' };
    const groups = []; let curKey = null, curParas = [];
    while (i < kids.length) {
      const el = kids[i], sty = _hdParaStyle(el);
      if (el.tagName === 'w:p' && (sty === 'Heading1' || sty === 'Heading2')) break;
      if (el.tagName === 'w:p' && sty === 'Heading3') {
        if (curKey) groups.push({ key: curKey, paraEls: curParas });
        curKey = H3[_hdNorm(_hdGetText(el))] || null; curParas = [];
      } else if (el.tagName === 'w:p' && curKey) curParas.push(el);
      i++;
    }
    if (curKey) groups.push({ key: curKey, paraEls: curParas });
    const eow = data[sec.id] || {};
    groups.forEach(g => {
      const text = eow[g.key] || '';
      if (g.paraEls.length) { _hdSetParaText(xmlDoc, g.paraEls[0], text); g.paraEls.slice(1).forEach(p => _hdSetParaText(xmlDoc, p, '')); }
    });
  }
  return i;
}

function _hdWriteDoc(xmlDoc, data, themes) {
  const body = xmlDoc.getElementsByTagName('w:body')[0]; if (!body) return;
  const kids = Array.from(body.children);
  let i = 0;
  while (i < kids.length) {
    const el = kids[i];
    if (el.tagName === 'w:p' && _hdParaStyle(el).startsWith('Heading')) {
      const secId = NEXUSMD_DOCX_HEADING_MAP[_hdNorm(_hdGetText(el).trim())];
      if (secId) {
        const sec = PLANNER_SECTIONS.find(s => s.id === secId);
        if (sec) { i++; i = _hdWriteSection(sec, kids, i, body, xmlDoc, data, themes); continue; }
      }
    }
    i++;
  }
}

export async function plannerExportDocx(data, themes, dateLabel) {
  if (typeof JSZip === 'undefined') { alert('JSZip library not loaded.'); return; }
  try {
    const resp = await fetch('/templates/Weekly_Planner.docx');
    if (!resp.ok) throw new Error('Could not load template (HTTP ' + resp.status + ')');
    const zip = await JSZip.loadAsync(await resp.arrayBuffer());
    const xmlStr = await zip.file('word/document.xml').async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlStr, 'application/xml');
    if (xmlDoc.querySelector('parsererror')) throw new Error('Template XML is malformed.');
    _hdWriteDoc(xmlDoc, data, themes);
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'planner-' + (dateLabel || new Date().toISOString().slice(0, 10)) + '.docx';
    a.click(); URL.revokeObjectURL(a.href);
  } catch (err) {
    alert('Word export failed:\n' + err.message);
  }
}

// ── Version helpers (unchanged) ───────────────────────────────
export function loadVersions() {
  try { return JSON.parse(localStorage.getItem('nexusmd.planner.versions') || '[]'); } catch { return []; }
}
export function saveVersions(versions) {
  const s = JSON.stringify(versions);
  try { localStorage.setItem('nexusmd.planner.versions', s); } catch (_) {}
  nexusMDPushPref?.('nexusmd.planner.versions', s);
}
export function describeSnapshot(data) {
  const tasks = (data.tasks || []).length;
  const meetings = (data.meetSched || []).length;
  const oneOnOnes = (data.oneOnOnes || []).length;
  const parts = [];
  if (tasks) parts.push(`${tasks} task${tasks !== 1 ? 's' : ''}`);
  if (meetings) parts.push(`${meetings} meeting${meetings !== 1 ? 's' : ''}`);
  if (oneOnOnes) parts.push(`${oneOnOnes} 1:1${oneOnOnes !== 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'empty planner';
}

// ── Per-week storage helpers (unchanged) ──────────────────────
export function loadWeekPlanner(year, week) {
  try {
    const raw = localStorage.getItem(weekStorageKey(year, week));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
export function saveWeekPlanner(year, week, data, themes) {
  const key = weekStorageKey(year, week);
  const s = JSON.stringify({ data, themes });
  try { localStorage.setItem(key, s); } catch {}
  nexusMDPushPref?.(key, s);
  PlannerSync?.onWeekSaved(year, week);
}
export function deleteWeekPlanner(year, week) {
  const key = weekStorageKey(year, week);
  try { localStorage.removeItem(key); } catch {}
  nexusMDPushPref?.(key, null);
}
export function getWeeksWithData() {
  const result = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('nexusmd.planner.week.')) {
        result.add(k.replace('nexusmd.planner.week.', ''));
      }
    }
  } catch {}
  return result;
}

const PLANNER_MIGRATION_FLAG = 'nexusmd.planner.legacyMigrated';
export function isLegacyMigrationDone() {
  try { return localStorage.getItem(PLANNER_MIGRATION_FLAG) === '1'; } catch { return false; }
}
export function markLegacyMigrationDone() {
  try { localStorage.setItem(PLANNER_MIGRATION_FLAG, '1'); } catch {}
  nexusMDPushPref?.(PLANNER_MIGRATION_FLAG, '1');
}
// Scans all stored planner weeks for confidential rows whose _reminderDate is
// today or in the past and that haven't been dismissed. Returns an array of
// { rowId, sectionId, reminderDate, weekKey, weekOffset }.
export function checkConfidentialReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const dismissed = new Set();
  try { JSON.parse(localStorage.getItem('nexusmd.planner.reminderDismissed') || '[]').forEach(k => dismissed.add(k)); } catch {}
  const due = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('nexusmd.planner.week.')) continue;
    try {
      const saved = JSON.parse(localStorage.getItem(k) || 'null');
      if (!saved?.data) continue;
      for (const sec of PLANNER_SECTIONS) {
        if (sec.type !== 'table') continue;
        for (const row of (saved.data[sec.id] || [])) {
          if (row._reminderDate && row._reminderDate <= today && !dismissed.has(row.id + ':' + row._reminderDate)) {
            due.push({ rowId: row.id, sectionId: sec.id, reminderDate: row._reminderDate, weekKey: k, weekOffset: weekKeyToOffset(k) });
          }
        }
      }
    } catch {}
  }
  return due;
}

// Continued in view-planner-2.jsx (modals, calendar picker, PlannerView).
