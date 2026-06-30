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
