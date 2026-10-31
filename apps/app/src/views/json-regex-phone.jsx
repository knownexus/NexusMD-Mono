// json-regex-phone.jsx — the JSON and Regex tools on a phone, each one focused pane. They share the
// desktop layout's autosave hook and storage keys, so saved documents carry over.
import React from 'react';
import {
  useDocumentAutosave, typeOf, findMatches, buildOverlaySegments, splitMatchByGroups, genCode, REFERENCE_DATA,
} from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { Sheet } from '../components.jsx';
import { ToolFrame, DocsSheet } from './docs-frame.jsx';

const { useState, useMemo, useEffect } = React;
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

// Opens the most recently edited saved document on first show, so the tool resumes where it was left.
function useResume(docs, currentDocId, openDoc) {
  useEffect(() => {
    if (currentDocId || !docs.length) return;
    openDoc([...docs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── JSON ──────────────────────────────────────────────────────────────────────
const SAMPLE_TEXT = JSON.stringify({
  name: 'Alice Johnson', age: 28, active: true, role: null,
  address: { street: '12 Oak Avenue', city: 'Bristol', postcode: 'BS1 4QX' },
  tags: ['developer', 'designer', 'mentor'], score: 94.5,
}, null, 2);

// A saved document's name: a top-level "name"/"title" string if there is one, else a snippet.
export function jsonAutoName(text) {
  try {
    const p = JSON.parse(text);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const n = p.name ?? p.title;
      if (typeof n === 'string' && n.trim()) return n.trim().slice(0, 80);
    }
  } catch { /* fall through to the snippet */ }
  const s = text.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, 60) : 'Untitled';
}

export function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: e.message }; }
}

const preview = (v) => {
  const t = typeOf(v);
  return t === 'object' ? `{ ${Object.keys(v).length} }` : t === 'array' ? `[ ${v.length} ]` : t === 'string' ? JSON.stringify(v) : String(v);
};

function TreeNode({ k, v, depth, path, flipped, flip }) {
  const t = typeOf(v);
  const container = t === 'object' || t === 'array';
  const open = container && (depth < 2) !== flipped.has(path);
  return (
    <div className="m-tree-node">
      <div className={`m-tree-row${container ? ' tap' : ''}`} onClick={container ? () => flip(path) : undefined}>
        <span className="m-tree-caret">{container ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13}/> : null}</span>
        {k != null && <span className="m-tree-key">{k}</span>}
        <span className={`m-tree-val ${t}`}>{preview(v)}</span>
      </div>
      {open && (
        <div className="m-tree-kids">
          {(t === 'array' ? v.map((x, i) => [i, x]) : Object.entries(v)).map(([ck, cv]) => (
            <TreeNode key={ck} k={ck} v={cv} depth={depth + 1} path={`${path}/${ck}`} flipped={flipped} flip={flip}/>
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonPhone({ tool, setTool, onFlash }) {
  const d = useDocumentAutosave({
    storageKey: 'json_editor_documents', initialContent: SAMPLE_TEXT, emptyContent: '{}',
    isEmpty: t => !t.trim(), extractAutoName: jsonAutoName,
  });
  useResume(d.docs, d.currentDocId, d.openDoc);
  const [mode, setMode] = useState('edit');
  const [sheet, setSheet] = useState(false);
  const [flipped, setFlipped] = useState(() => new Set());
  const parsed = useMemo(() => parseJson(d.content), [d.content]);
  const flip = (p) => setFlipped(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const current = d.docs.find(x => x.id === d.currentDocId);
  const title = current ? (current.name ?? current.autoName) : 'New document';

  const act = (fn) => { if (parsed.ok) d.setContent(fn(parsed.value)); };
  const status = d.saveStatus === 'saving' ? 'Saving…' : d.saveStatus === 'saved' ? 'Saved' : '';

  return (
    <>
      <ToolFrame sub={title} tool={tool} setTool={setTool} onDocs={() => setSheet(true)} onNew={() => { d.newDoc(); setMode('edit'); }}
        footer={(
          <div className="m-docs-foot">
            <span className={`m-json-state ${parsed.ok ? 'ok' : 'bad'}`}>{parsed.ok ? 'Valid JSON' : 'Invalid JSON'}</span>
            <span className="m-docs-status">{status}</span>
          </div>
        )}>
        <div className="m-seg" style={{ margin: '0 0 10px' }}>
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className={mode === 'tree' ? 'active' : ''} onClick={() => setMode('tree')}>Tree</button>
        </div>
        {mode === 'edit' ? (
          <>
            <div className="m-docs-chips">
              <button type="button" className="m-chip" disabled={!parsed.ok} onClick={() => act(v => JSON.stringify(v, null, 2))}>Format</button>
              <button type="button" className="m-chip" disabled={!parsed.ok} onClick={() => act(v => JSON.stringify(v))}>Minify</button>
              <button type="button" className="m-chip" onClick={() => { copy(d.content); onFlash?.('Copied'); }}>Copy</button>
            </div>
            <textarea className="m-docs-text" value={d.content} onChange={e => d.setContent(e.target.value)}
              spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="JSON"/>
            {!parsed.ok && d.content.trim() && <div className="m-error" role="alert">{parsed.message}</div>}
          </>
        ) : (
          <div className="m-docs-preview">
            {parsed.ok
              ? <TreeNode k={null} v={parsed.value} depth={0} path="" flipped={flipped} flip={flip}/>
              : <div className="m-error" role="alert">Fix the JSON to see the tree. {parsed.message}</div>}
          </div>
        )}
      </ToolFrame>
      <DocsSheet open={sheet} onClose={() => setSheet(false)} docs={d.docs} currentDocId={d.currentDocId} name="JSON documents"
        onOpen={(id) => { d.openDoc(id); setMode('edit'); }} onNew={() => { d.newDoc(); setMode('edit'); }} onRename={d.renameDoc} onDelete={d.deleteDoc}/>
    </>
  );
}

// ── Regex ─────────────────────────────────────────────────────────────────────
const FLAGS = [['g', 'Global'], ['i', 'Ignore case'], ['m', 'Multiline'], ['s', 'Dotall'], ['u', 'Unicode']];
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6'];

export const flagsToString = (flags) => Object.keys(flags).filter(f => flags[f]).join('');
export const regexAutoName = (s) => (s.pattern ? `/${s.pattern}/${flagsToString(s.flags)}`.slice(0, 80) : 'Untitled');
export const DEFAULT_REGEX = {
  pattern: '(\\w+)@([\\w.-]+\\.[a-z]{2,})',
  flags: { g: true, i: false, m: false, s: false, u: false },
  mode: 'match',
  testCases: [
    { name: 'Email', content: 'support@example.com\nsales@company.org\njohn.doe@email.co.uk\n\nInvalid: notanemail, @nodomain.com' },
    { name: 'URL', content: 'https://www.example.com/path?q=1&page=2\nhttp://sub.example.co.uk#anchor\nftp://files.server.net/data.zip' },
    { name: 'Phone', content: '+1 (555) 123-4567\n+44 20 7946 0958\n555.867.5309\n1-800-GOT-JUNK' },
    { name: 'Dates', content: '2024-01-15\n15/01/2024\nJanuary 15, 2024\nJan 15 2024' },
  ],
  tcIndex: 0,
  subReplacement: '',
  unitTests: [{ str: 'test@example.com', expectMatch: true }, { str: 'not-an-email', expectMatch: false }],
};

export function patternError(pattern, flags) {
  if (!pattern) return '';
  try { new RegExp(pattern, flags); return ''; } catch (e) { return e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, ''); }
}

function Highlighted({ text, matches }) {
  const segs = buildOverlaySegments(text, matches);
  return (
    <div className="m-rx-text">
      {segs.map((s, i) => s.matchIndex == null
        ? <span key={i}>{s.text}</span>
        : <mark key={i} className="m-rx-hit">
            {splitMatchByGroups(s.text, s.groupSpans).map((p, j) => (
              <span key={j} style={p.colorIndex == null ? undefined : { background: GROUP_COLORS[p.colorIndex] + '55', borderRadius: 3 }}>{p.text}</span>
            ))}
          </mark>)}
    </div>
  );
}

export function RegexPhone({ tool, setTool, onFlash }) {
  const d = useDocumentAutosave({
    storageKey: 'regex_tester_documents', initialContent: DEFAULT_REGEX, emptyContent: { ...DEFAULT_REGEX, pattern: '' },
    isEmpty: s => !s.pattern, extractAutoName: regexAutoName,
  });
  useResume(d.docs, d.currentDocId, d.openDoc);
  const [sheet, setSheet] = useState(false);
  const [ref, setRef] = useState(false);
  const s = d.content;
  const patch = (p) => d.setContent(prev => ({ ...prev, ...p }));
  const flagsStr = flagsToString(s.flags);
  const tc = s.testCases[s.tcIndex] || s.testCases[0];
  const err = patternError(s.pattern, flagsStr);
  const matches = useMemo(() => (s.pattern && !err ? (findMatches(s.pattern, flagsStr, tc.content) || []) : []), [s.pattern, flagsStr, tc.content, err]);
  const current = d.docs.find(x => x.id === d.currentDocId);
  const status = d.saveStatus === 'saving' ? 'Saving…' : d.saveStatus === 'saved' ? 'Saved' : '';

  const setTestText = (content) => patch({ testCases: s.testCases.map((c, i) => (i === s.tcIndex ? { ...c, content } : c)) });
  const insert = (k, section) => {
    if (section === 'Flags') patch({ flags: { ...s.flags, [k]: !s.flags[k] } });
    else patch({ pattern: s.pattern + k });
    setRef(false);
  };

  return (
    <>
      <ToolFrame sub={current ? (current.name ?? current.autoName) : 'New document'} tool={tool} setTool={setTool}
        onDocs={() => setSheet(true)} onNew={() => d.newDoc()}
        actions={<button type="button" className="m-iconbtn" aria-label="Reference" onClick={() => setRef(true)}><Icon name="list" size={18}/></button>}
        footer={(
          <div className="m-docs-foot">
            <span>{err ? 'Invalid pattern' : s.pattern ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Enter a pattern'}</span>
            <span className="m-docs-status">{status}</span>
          </div>
        )}>
        <div className="m-fld" style={{ marginBottom: 10 }}>
          <label>Pattern</label>
          <input className="m-rx-pattern" value={s.pattern} onChange={e => patch({ pattern: e.target.value })}
            placeholder="(\w+)@(\w+)" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Pattern"/>
          {err && <div className="m-error" role="alert" style={{ marginTop: 6 }}>{err}</div>}
        </div>
        <div className="m-docs-chips">
          {FLAGS.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={!!s.flags[f]} title={label} className={`m-chip${s.flags[f] ? ' active' : ''}`}
              onClick={() => patch({ flags: { ...s.flags, [f]: !s.flags[f] } })}>{f}</button>
          ))}
          <button type="button" className="m-chip" disabled={!s.pattern || !!err}
            onClick={() => { copy(genCode('JS', s.pattern, flagsStr)); onFlash?.('Copied as JavaScript'); }}>Copy JS</button>
        </div>
        <div className="m-fld" style={{ marginBottom: 10 }}>
          <label>Test text</label>
          <select className="m-select" aria-label="Sample" value={s.tcIndex} onChange={e => patch({ tcIndex: Number(e.target.value) })} style={{ marginBottom: 8 }}>
            {s.testCases.map((c, i) => <option key={i} value={i}>{c.name || `Sample ${i + 1}`}</option>)}
          </select>
          <textarea className="m-docs-text short" value={tc.content} onChange={e => setTestText(e.target.value)} spellCheck={false} aria-label="Test text"/>
        </div>
        <div className="m-sec-h"><span className="lbl">Matches</span><span className="line"/><span className="cnt">{matches.length}</span></div>
        {s.pattern && !err && <Highlighted text={tc.content} matches={matches}/>}
        {matches.length > 0 && (
          <div className="m-card flush" style={{ marginTop: 10 }}>
            {matches.slice(0, 50).map((m, i) => (
              <div key={i} className="m-row" style={{ cursor: 'default' }}>
                <div className="m-row-main">
                  <div className="m-row-title mono" style={{ wordBreak: 'break-all' }}>{m.value || '(empty)'}</div>
                  <div className="m-row-sub">at {m.index}{m.groups.length ? ` · ${m.groups.map((g, gi) => `$${gi + 1} ${g ?? '∅'}`).join(' · ')}` : ''}</div>
                </div>
              </div>
            ))}
            {matches.length > 50 && <div className="m-row-sub" style={{ padding: 12 }}>and {matches.length - 50} more</div>}
          </div>
        )}
      </ToolFrame>

      <DocsSheet open={sheet} onClose={() => setSheet(false)} docs={d.docs} currentDocId={d.currentDocId} name="regex documents"
        onOpen={d.openDoc} onNew={() => d.newDoc()} onRename={d.renameDoc} onDelete={d.deleteDoc}/>

      <Sheet open={ref} size="tall" icon="list" title="Reference" sub="Tap to add to the pattern" onClose={() => setRef(false)}>
        {REFERENCE_DATA.filter(sec => sec.t !== 'Substitution tokens').map(sec => (
          <React.Fragment key={sec.t}>
            <div className="m-sec-h"><span className="lbl">{sec.t}</span><span className="line"/></div>
            <div className="m-card flush">
              {sec.i.map(it => (
                <div key={it.k} className="m-row" onClick={() => insert(it.k, sec.t)}>
                  <code className="m-rx-token">{it.k}</code>
                  <div className="m-row-main"><div className="m-row-sub" style={{ marginTop: 0 }}>{it.d}</div></div>
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}
      </Sheet>
    </>
  );
}
