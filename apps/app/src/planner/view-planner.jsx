import React from 'react';
import { PrioChip } from './planner-ui.jsx';
import JSZip from 'jszip';
import { helmPushPref } from '../components.jsx';
import { getProfileKey } from '../profile-keys.js';
// view-planner.jsx — Weekly planner v2
// Redesign: glance overview, grouped navigation (rail/scroll/tabs), three entry
// styles (inline/quick-add/drawer), carry-over, multi-notes, week-agnostic notes.
// Preserved from v1: DOCX export, per-week storage + legacy migration, versions,
// confidential sections/rows (SHA-256 + AES-GCM sync), calendar picker,
// HelmNav navigation, helm:create-wi context menu.
// Requires (load before this file): planner-ui.jsx, planner-notes.jsx,
// planner-editors.jsx, planner-glance.jsx, css/helm-planner-v2.css.

// ── DOCX export helpers (unchanged from v1) ──────────────────
const _HD_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const HELM_DOCX_HEADING_MAP = {
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
      const secId = HELM_DOCX_HEADING_MAP[_hdNorm(_hdGetText(el).trim())];
      if (secId) {
        const sec = PLANNER_SECTIONS.find(s => s.id === secId);
        if (sec) { i++; i = _hdWriteSection(sec, kids, i, body, xmlDoc, data, themes); continue; }
      }
    }
    i++;
  }
}

async function plannerExportDocx(data, themes, dateLabel) {
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
function loadVersions() {
  try { return JSON.parse(localStorage.getItem(getProfileKey('helm.planner.versions')) || '[]'); } catch { return []; }
}
function saveVersions(versions) {
  const s = JSON.stringify(versions);
  try { localStorage.setItem(getProfileKey('helm.planner.versions'), s); } catch (_) {}
  helmPushPref?.('helm.planner.versions', s);
}
function describeSnapshot(data) {
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
function getIsoYearWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year, week };
}
function getYearWeekForOffset(offset) {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1 + offset * 7);
  return getIsoYearWeek(monday);
}
function getMondayOfDate(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekStorageKey(year, week) {
  return `helm.planner.week.${year}-W${String(week).padStart(2, '0')}`;
}
function loadWeekPlanner(year, week) {
  try {
    const raw = localStorage.getItem(getProfileKey(weekStorageKey(year, week)));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function saveWeekPlanner(year, week, data, themes) {
  const key = weekStorageKey(year, week);
  const s = JSON.stringify({ data, themes });
  try { localStorage.setItem(getProfileKey(key), s); } catch {}
  helmPushPref?.(key, s);
}
function deleteWeekPlanner(year, week) {
  const key = weekStorageKey(year, week);
  try { localStorage.removeItem(getProfileKey(key)); } catch {}
  helmPushPref?.(key, null);
}
function getWeeksWithData() {
  const result = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const weekPrefix = getProfileKey('helm.planner.week.');
      if (k && k.startsWith(weekPrefix)) {
        result.add(k.replace(weekPrefix, ''));
      }
    }
  } catch {}
  return result;
}

const PLANNER_MIGRATION_FLAG = 'helm.planner.legacyMigrated';
function isLegacyMigrationDone() {
  try { return localStorage.getItem(getProfileKey(PLANNER_MIGRATION_FLAG)) === '1'; } catch { return false; }
}
function markLegacyMigrationDone() {
  try { localStorage.setItem(getProfileKey(PLANNER_MIGRATION_FLAG), '1'); } catch {}
  helmPushPref?.(PLANNER_MIGRATION_FLAG, '1');
}
function hasMeaningfulPlannerData(data, themes) {
  if (!data) return false;
  for (const sec of PLANNER_SECTIONS) {
    const v = data[sec.id];
    if (sec.type === 'table' && Array.isArray(v) && v.length > 0) return true;
    if (sec.type === 'textarea' && typeof v === 'string' && v.trim()) return true;
    if ((sec.type === 'keyval' || sec.type === 'eow') && v && typeof v === 'object') {
      if (Object.values(v).some(x => typeof x === 'string' && x.trim())) return true;
    }
  }
  if (themes && typeof themes === 'object') {
    if (Object.values(themes).some(x => typeof x === 'string' && x.trim())) return true;
  }
  return false;
}
function buildEmptyPlannerData() {
  const e = {};
  for (const sec of PLANNER_SECTIONS) {
    if (sec.type === 'table') e[sec.id] = [];
    else if (sec.type === 'keyval') e[sec.id] = {};
    else if (sec.type === 'textarea') e[sec.id] = '';
    else if (sec.type === 'eow') e[sec.id] = { well:'', didNot:'', carry:'' };
  }
  return e;
}

// ── Confidential helpers (unchanged) ──────────────────────────
async function hashPassword(password) {
  try {
    const data = new TextEncoder().encode(password + ' helm-planner');
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {
    return btoa(unescape(encodeURIComponent(password)));
  }
}
async function encryptConfidentialForServer(cfg, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(cfg));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
}
async function decryptConfidentialFromServer(encrypted, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = new Uint8Array(encrypted.iv.match(/.{2}/g).map(h => parseInt(h, 16)));
  const ct = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(decrypted));
}
function loadConfidentialConfig() {
  try { return JSON.parse(localStorage.getItem(getProfileKey('helm.planner.confidential')) || '{"sections":[],"hash":null}'); }
  catch { return { sections: [], hash: null }; }
}
function saveConfidentialConfig(cfg) {
  try { localStorage.setItem(getProfileKey('helm.planner.confidential'), JSON.stringify(cfg)); } catch {}
  if (cfg.hash) {
    (async () => {
      try {
        const encrypted = await encryptConfidentialForServer(cfg, cfg.hash);
        helmPushPref?.('helm.planner.confidential', JSON.stringify(encrypted));
      } catch (_) {}
    })();
  }
}

const { useState: useStatePL, useEffect: useEffectPL, useMemo: useMemoPL, useRef: useRefPL, useCallback: useCallbackPL } = React;

// ── Sections (same ids/cols as v1 — DOCX + import/export compatible) ──
// New per-column flag: `main` (primary text col); per-section: icon, hasNotes.
// Priority columns render as PrioChip (`t:'prio'`) but store identical strings.
const PLANNER_SECTIONS = [
  { id:'tasks', num:'1', title:'My tasks', icon:'check-circle', type:'table', cols:[
    { k:'task', l:'Task', t:'text', w:'34%', main:true }, { k:'category', l:'Category', t:'sel', w:'14%', o:['','Admin','Architecture','Delivery','HR / People','Infrastructure','Process','Strategy','Technical'] },
    { k:'due', l:'Due', t:'date', w:'14%' }, { k:'priority', l:'Priority', t:'prio', w:'18%' }, { k:'status', l:'Status', t:'status', w:'20%' },
  ]},
  { id:'meetSched', num:'2a', title:'Meetings - schedule', icon:'planner', type:'table', cols:[
    { k:'dayTime', l:'Day / Time', t:'datetime', w:'14%' }, { k:'meeting', l:'Meeting', t:'text', w:'18%', main:true }, { k:'attendees', l:'Attendees', t:'text', w:'17%' },
    { k:'prep', l:'Prep needed', t:'text', w:'20%' }, { k:'owner', l:'Owner', t:'text', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'meetNotes', num:'2b', title:'Meetings - notes & decisions', icon:'edit', type:'table', hasNotes: true, cols:[
    { k:'meeting', l:'Meeting', t:'text', w:'16%', main:true }, { k:'decisions', l:'Key decisions', t:'text', w:'26%' }, { k:'actions', l:'Action items', t:'text', w:'24%' },
    { k:'followBy', l:'Follow-up by', t:'text', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'chatsIn', num:'3a', title:'Chats - needs my response', icon:'inbox', type:'table', cols:[
    { k:'from', l:'From', t:'text', w:'14%' }, { k:'topic', l:'Topic', t:'text', w:'24%', main:true }, { k:'needed', l:'What is needed', t:'text', w:'26%' },
    { k:'due', l:'Due', t:'date', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'chatsOut', num:'3b', title:'Chats I need to start', icon:'message', type:'table', cols:[
    { k:'who', l:'Who', t:'text', w:'14%' }, { k:'topic', l:'Topic', t:'text', w:'24%', main:true }, { k:'why', l:'Why / goal', t:'text', w:'24%' },
    { k:'channel', l:'Channel', t:'text', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'statusUpdates', num:'3c', title:'Status updates to send', icon:'send', type:'table', cols:[
    { k:'audience', l:'Audience', t:'text', w:'16%', main:true }, { k:'cadence', l:'Cadence', t:'text', w:'14%' }, { k:'content', l:'Content / link', t:'text', w:'32%' },
    { k:'due', l:'Due', t:'date', w:'14%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'oneOnOnes', num:'4a', title:'1:1s', icon:'team', type:'table', cols:[
    { k:'person', l:'Direct report', t:'text', w:'14%', main:true }, { k:'date', l:'Date', t:'date', w:'12%' }, { k:'points', l:'Talking points', t:'text', w:'22%' },
    { k:'theirAsks', l:'Their asks', t:'text', w:'18%' }, { k:'actions', l:'Actions / owner', t:'text', w:'18%' }, { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'teamNotes', num:'4c', title:'Team notes', icon:'lock', type:'table', defaultConfidential: true, cols:[
    { k:'person', l:'Person', t:'text', w:'16%', main:true },
    { k:'note', l:'Note', t:'text', w:'52%' },
    { k:'date', l:'Date', t:'date', w:'16%' },
    { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'themes', num:'4b', title:'Themes to watch', icon:'eye', type:'keyval', fields:[
    { k:'morale', l:'Morale / wellbeing flags' }, { k:'delivery', l:'Delivery confidence' }, { k:'capability', l:'Capability / skill gaps' },
    { k:'process', l:'Process friction' }, { k:'stakeholder', l:'Stakeholder noise' }, { k:'risks', l:'Risks to escalate' },
  ]},
  { id:'dailyLog', num:'5a', title:'Recurring issues - daily log', icon:'clock', type:'table', hasNotes: true, cols:[
    { k:'date', l:'Date', t:'date', w:'11%' }, { k:'person', l:'Person', t:'text', w:'12%', main:true }, { k:'obs', l:'Observation', t:'text', w:'28%' },
    { k:'duration', l:'Duration / count', t:'text', w:'14%' }, { k:'evidence', l:'Notes / evidence', t:'text', w:'18%' }, { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'actionPlan', num:'5c', title:'Action plan - per person', icon:'flag', type:'table', cols:[
    { k:'person', l:'Person', t:'text', w:'13%', main:true }, { k:'tried', l:'What I have tried', t:'text', w:'26%' }, { k:'next', l:'Next step / owner', t:'text', w:'24%' },
    { k:'reviewBy', l:'Review by', t:'date', w:'12%' }, { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'workItemsPlan', num:'7', title:'Work item creation queue', icon:'work', type:'table', cols:[
    { k:'title', l:'Title / summary', t:'text', w:'28%', main:true }, { k:'type', l:'Type', t:'sel', w:'12%', o:['','Bug','Task','User Story','Feature','Epic','Spike'] },
    { k:'area', l:'Area / iteration', t:'text', w:'16%' }, { k:'source', l:'Source / requester', t:'text', w:'14%' }, { k:'priority', l:'Priority', t:'prio', w:'14%' },
    { k:'adoNum', l:'ADO #', t:'text', w:'8%' }, { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'teamTasks', num:'9', title:'Tasks for team / devs', icon:'team', type:'table', cols:[
    { k:'task', l:'Task', t:'text', w:'28%', main:true }, { k:'assignedTo', l:'Assigned to', t:'text', w:'14%' }, { k:'context', l:'Context / link', t:'text', w:'26%' },
    { k:'due', l:'Due', t:'date', w:'12%' }, { k:'status', l:'Status', t:'status', w:'16%' },
  ]},
  { id:'reminders', num:'10', title:'Reminders', icon:'bell', type:'table', cols:[
    { k:'reminder', l:'Reminder', t:'text', w:'38%', main:true }, { k:'trigDate', l:'Trigger date', t:'date', w:'14%' }, { k:'why', l:'Why', t:'text', w:'30%' }, { k:'status', l:'Status', t:'status', w:'14%' },
  ]},
  { id:'notes', num:'11', title:'Notes & parking lot', icon:'edit', type:'textarea' },
  { id:'eow', num:'12', title:'End-of-week review', icon:'check', type:'eow' },
];

const PL_GROUPS = [
  { id:'personal', label:'My week',   icon:'check-circle', ids:['tasks','reminders'] },
  { id:'meetings', label:'Meetings',  icon:'planner', ids:['meetSched','meetNotes'] },
  { id:'comms',    label:'Comms',     icon:'message', ids:['chatsIn','chatsOut','statusUpdates'] },
  { id:'people',   label:'People',    icon:'team', ids:['oneOnOnes','teamNotes','themes','dailyLog','actionPlan'] },
  { id:'work',     label:'Work items',icon:'work', ids:['workItemsPlan','teamTasks'] },
  { id:'wrap',     label:'Wrap-up',   icon:'flag', ids:['notes','eow'] },
];
function plSectionGroup(sectionId) { return PL_GROUPS.find(g => g.ids.includes(sectionId)); }

function getIsoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// Converts a stored week key ('helm.planner.week.YYYY-Www') to a weekOffset
// relative to the current week (0 = current, -1 = last week, +1 = next week).
function weekKeyToOffset(weekKey) {
  const match = weekKey.match(/(\d{4})-W(\d{2})$/);
  if (!match) return 0;
  const tYear = parseInt(match[1]), tWeek = parseInt(match[2]);
  for (let offset = -52; offset <= 52; offset++) {
    const { year, week } = getYearWeekForOffset(offset);
    if (year === tYear && week === tWeek) return offset;
  }
  return 0;
}

// Scans all stored planner weeks for confidential rows whose _reminderDate is
// today or in the past and that haven't been dismissed. Returns an array of
// { rowId, sectionId, reminderDate, weekKey, weekOffset }.
function checkConfidentialReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const dismissed = new Set();
  try { JSON.parse(localStorage.getItem(getProfileKey('helm.planner.reminderDismissed')) || '[]').forEach(k => dismissed.add(k)); } catch {}
  const due = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(getProfileKey('helm.planner.week.'))) continue;
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

export {
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
};


