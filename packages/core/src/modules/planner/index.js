// planner module — week/date helpers, section schema, and data-shape utilities.
//
// Pure, platform-agnostic logic extracted from the app layer (Phase 5). Storage
// (localStorage / file adapter), DOCX export (DOM-bound), and the Google-Drive
// sync engine stay in the apps; everything here is plain data + date math (plus
// the pure confidential AES-GCM crypto) so every app shares one implementation.

// Planner v2 date/status helpers (PL_STATUSES, plParseYmd, plIsOverdueYmd, …).
export * from './dates.js'

// Confidential AES-GCM crypto (hashPassword, encrypt/decryptConfidentialForServer).
export * from './confidential.js'

// ── ISO week / date helpers ───────────────────────────────────────────────────

/** ISO-8601 year+week for a given Date. */
export function getIsoYearWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const year = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return { year, week }
}

/** ISO year+week for the Monday `offset` weeks from the current week (0 = this week). */
export function getYearWeekForOffset(offset) {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  return getIsoYearWeek(monday)
}

/** The Monday (local midnight) of the week containing `date`. */
export function getMondayOfDate(date) {
  const d = new Date(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** ISO week number (1-53) for a Date. */
export function getIsoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
}

/** Short, locale-aware date label, e.g. "Jun 25". */
export function fmtDateShort(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** localStorage / cache key for a week's planner payload. Pure string builder. */
export function weekStorageKey(year, week) {
  return `nexusmd.planner.week.${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Convert a stored week key ('…YYYY-Www', or bare 'YYYY-Www') to a week offset
 * relative to the current week (0 = current, -1 = last week, +1 = next). Returns
 * 0 if it can't be matched within ±52 weeks.
 */
export function weekKeyToOffset(weekKey) {
  const match = String(weekKey || '').match(/(\d{4})-W(\d{2})$/)
  if (!match) return 0
  const tYear = parseInt(match[1]), tWeek = parseInt(match[2])
  for (let offset = -52; offset <= 52; offset++) {
    const { year, week } = getYearWeekForOffset(offset)
    if (year === tYear && week === tWeek) return offset
  }
  return 0
}

// ── Section schema ─────────────────────────────────────────────────────────────
// Same ids/cols as the v1 planner — DOCX export + import/export stay compatible.
// Per-column `main` marks the primary text column; per-section `icon`, `hasNotes`,
// `defaultConfidential`. Priority columns render as a chip (`t:'prio'`) but store
// plain strings.

export const PLANNER_SECTIONS = [
  { id:'tasks', num:'1', title:'My tasks', icon:'check-circle', type:'table', cols:[
    { k:'task', l:'Task', t:'text', w:'34%', main:true }, { k:'category', l:'Category', t:'sel', w:'14%', o:['','Admin','Architecture','Delivery','HR / People','Infrastructure','Process','Strategy','Technical'] },
    { k:'due', l:'Due', t:'date', w:'14%' }, { k:'priority', l:'Priority', t:'prio', w:'18%' }, { k:'status', l:'Status', t:'status', w:'20%' },
  ]},
  { id:'meetSched', num:'2a', title:'Meetings - schedule', icon:'planner', type:'table', cols:[
    { k:'dayTime', l:'Day / Time', t:'datetime', w:'14%' }, { k:'meeting', l:'Meeting', t:'text', w:'20%', main:true }, { k:'attendees', l:'Attendees', t:'text', w:'18%' },
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
]

export const PL_GROUPS = [
  { id:'personal', label:'My week',   icon:'check-circle', ids:['tasks','reminders'] },
  { id:'meetings', label:'Meetings',  icon:'planner', ids:['meetSched','meetNotes'] },
  { id:'comms',    label:'Comms',     icon:'message', ids:['chatsIn','chatsOut','statusUpdates'] },
  { id:'people',   label:'People',    icon:'team', ids:['oneOnOnes','teamNotes','themes','dailyLog','actionPlan'] },
  { id:'work',     label:'Work items',icon:'work', ids:['workItemsPlan','teamTasks'] },
  { id:'wrap',     label:'Wrap-up',   icon:'flag', ids:['notes','eow'] },
]

/** The group a section belongs to, or undefined. */
export function plSectionGroup(sectionId) {
  return PL_GROUPS.find(g => g.ids.includes(sectionId))
}

// ── Data-shape utilities ────────────────────────────────────────────────────────

/** An empty planner-data object with the correct shape for every section. */
export function buildEmptyPlannerData() {
  const e = {}
  for (const sec of PLANNER_SECTIONS) {
    if (sec.type === 'table') e[sec.id] = []
    else if (sec.type === 'keyval') e[sec.id] = {}
    else if (sec.type === 'textarea') e[sec.id] = ''
    else if (sec.type === 'eow') e[sec.id] = { well:'', didNot:'', carry:'' }
  }
  return e
}

/** True if a planner-data object (and optional themes) holds any non-empty content. */
export function hasMeaningfulPlannerData(data, themes) {
  if (!data) return false
  for (const sec of PLANNER_SECTIONS) {
    const v = data[sec.id]
    if (sec.type === 'table' && Array.isArray(v) && v.length > 0) return true
    if (sec.type === 'textarea' && typeof v === 'string' && v.trim()) return true
    if ((sec.type === 'keyval' || sec.type === 'eow') && v && typeof v === 'object') {
      if (Object.values(v).some(x => typeof x === 'string' && x.trim())) return true
    }
  }
  if (themes && typeof themes === 'object') {
    if (Object.values(themes).some(x => typeof x === 'string' && x.trim())) return true
  }
  return false
}
