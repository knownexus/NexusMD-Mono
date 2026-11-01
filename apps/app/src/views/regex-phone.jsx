// regex-phone.jsx — the Regex tool on a phone. One column: the pattern with a live status, flags that
// say what they do, Match or Substitution, the test text, then tabs for Matches, Code, Tests and
// Reference, so nothing the desktop tool offers is lost. Shares its autosave hook and storage key
// with the desktop layout, so saved expressions carry over.
import React from 'react';
import {
  useDocumentAutosave, findMatches, buildOverlaySegments, splitMatchByGroups, runUnitTests, genCode, REFERENCE_DATA,
} from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { Sheet } from '../components.jsx';
import { ToolFrame, DocsSheet } from './docs-frame.jsx';

const { useState, useMemo, useEffect } = React;
const copy = (text) => (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Copying is not available here.')))
  .then(() => toast('Copied', 'success'), (e) => toast(`Could not copy. ${e?.message || ''}`.trim(), 'error'));

// What each flag does, in words: a phone has no hover, so these are shown, not tucked in a tooltip.
export const FLAGS = [
  { f: 'g', name: 'Global', does: 'find every match, not just the first' },
  { f: 'i', name: 'Ignore case', does: 'A and a count as the same letter' },
  { f: 'm', name: 'Multiline', does: '^ and $ match at every line, not just the whole text' },
  { f: 's', name: 'Dotall', does: '. also matches line breaks' },
  { f: 'u', name: 'Unicode', does: 'read the pattern as Unicode (accents, emoji)' },
];
export const LANGS = ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby'];
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6'];
const TABS = [['matches', 'Matches'], ['code', 'Code'], ['tests', 'Tests'], ['ref', 'Reference']];

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

// The one-line status beside the pattern.
export function statusOf(pattern, err, count) {
  if (!pattern) return { text: 'enter a pattern', tone: '' };
  if (err) return { text: 'invalid pattern', tone: 'danger' };
  return { text: `${count} ${count === 1 ? 'match' : 'matches'}`, tone: count ? 'success' : 'warning' };
}

// A match's capture groups as readable lines: numbered, and named ones by name.
export function groupLines(m) {
  const named = Object.entries(m.named || {});
  const lines = (m.groups || []).map((g, i) => ({ label: `$${i + 1}`, value: g }));
  named.forEach(([k, v]) => lines.push({ label: k, value: v }));
  return lines;
}

function Highlighted({ text, matches, sel }) {
  const segs = buildOverlaySegments(text, matches);
  return (
    <div className="m-rx-text">
      {segs.map((s, i) => s.matchIndex == null
        ? <span key={i}>{s.text}</span>
        : <mark key={i} className={`m-rx-hit${s.matchIndex === sel ? ' sel' : ''}`}>
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
  useEffect(() => {
    if (d.currentDocId || !d.docs.length) return;
    d.openDoc([...d.docs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [docsSheet, setDocsSheet] = useState(false);
  const [tab, setTab] = useState('matches');
  const [sel, setSel] = useState(-1);
  const [lang, setLang] = useState('JS');
  const [refFilter, setRefFilter] = useState('');
  const [addSample, setAddSample] = useState(null); // null | name being typed
  const [newTest, setNewTest] = useState({ str: '', expectMatch: true });

  const s = d.content;
  const patch = (p) => d.setContent(prev => ({ ...prev, ...p }));
  const flagsStr = flagsToString(s.flags);
  const tc = s.testCases[s.tcIndex] || s.testCases[0];
  const err = patternError(s.pattern, flagsStr);
  const matches = useMemo(() => (s.pattern && !err ? (findMatches(s.pattern, flagsStr, tc.content) || []) : []), [s.pattern, flagsStr, tc.content, err]);
  useEffect(() => { if (sel >= matches.length) setSel(-1); }, [matches.length, sel]);
  const status = statusOf(s.pattern, err, matches.length);
  const sub = s.mode === 'sub';
  const replaced = useMemo(() => {
    if (!sub || !s.pattern || err || !tc.content) return null;
    try { return tc.content.replace(new RegExp(s.pattern, flagsStr), s.subReplacement); } catch { return null; }
  }, [sub, s.pattern, err, flagsStr, tc.content, s.subReplacement]);
  const unitResults = useMemo(() => runUnitTests(s.unitTests, s.pattern, flagsStr), [s.unitTests, s.pattern, flagsStr]);
  const code = useMemo(() => (s.pattern && !err ? genCode(lang, s.pattern, flagsStr) : ''), [lang, s.pattern, err, flagsStr]);
  const current = d.docs.find(x => x.id === d.currentDocId);
  const save = d.saveStatus === 'saving' ? 'Saving…' : d.saveStatus === 'saved' ? 'Saved' : '';

  const toggleFlag = (f) => patch({ flags: { ...s.flags, [f]: !s.flags[f] } });
  const setTestText = (content) => patch({ testCases: s.testCases.map((c, i) => (i === s.tcIndex ? { ...c, content } : c)) });
  const insert = (k, section) => {
    if (section === 'Flags') toggleFlag(k);
    else if (section === 'Substitution tokens') patch({ subReplacement: s.subReplacement + k });
    else patch({ pattern: s.pattern + k });
    onFlash?.(section === 'Flags' ? `Flag ${k} toggled` : `Added ${k}`);
  };
  const addSampleCase = () => {
    const name = (addSample || '').trim() || `Sample ${s.testCases.length + 1}`;
    const next = [...s.testCases, { name, content: '' }];
    patch({ testCases: next, tcIndex: next.length - 1 });
    setAddSample(null); setSel(-1);
  };
  const addUnit = () => {
    if (!newTest.str.trim()) return;
    patch({ unitTests: [...s.unitTests, { str: newTest.str.trim(), expectMatch: newTest.expectMatch }] });
    setNewTest({ str: '', expectMatch: true });
  };
  const enabled = FLAGS.filter(x => s.flags[x.f]);
  const refSections = REFERENCE_DATA
    .filter(sec => sub || sec.t !== 'Substitution tokens')
    .map(sec => ({ ...sec, i: sec.i.filter(it => !refFilter.trim() || `${it.k} ${it.d}`.toLowerCase().includes(refFilter.trim().toLowerCase())) }))
    .filter(sec => sec.i.length);

  return (
    <>
      <ToolFrame sub={current ? (current.name ?? current.autoName) : 'New expression'} tool={tool} setTool={setTool}
        onDocs={() => setDocsSheet(true)} onNew={() => d.newDoc()}
        footer={(
          <div className="m-docs-foot">
            <span className={`m-rx-status ${status.tone}`}>{status.text}</span>
            <span className="m-docs-status">{save}</span>
          </div>
        )}>
        <div className="m-fld" style={{ marginBottom: 8 }}>
          <label>Pattern</label>
          <input className="m-rx-pattern" value={s.pattern} onChange={e => patch({ pattern: e.target.value })}
            placeholder="(\w+)@(\w+)" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Pattern"/>
          {err && <div className="m-error" role="alert" style={{ marginTop: 6 }}>{err}</div>}
        </div>

        <div className="m-docs-chips" role="group" aria-label="Flags">
          {FLAGS.map(x => (
            <button key={x.f} type="button" aria-pressed={!!s.flags[x.f]} className={`m-chip${s.flags[x.f] ? ' active' : ''}`} onClick={() => toggleFlag(x.f)}>
              {x.name} <span className="m-chip-count">{x.f}</span>
            </button>
          ))}
        </div>
        <div className="m-hint" style={{ marginTop: -4, marginBottom: 10 }} aria-live="polite">
          {enabled.length === 0
            ? 'No flags: the first match only, case matters, and ^ $ cover the whole text.'
            : enabled.map(x => `${x.name}: ${x.does}`).join(' · ')}
        </div>

        <div className="m-seg" role="tablist" aria-label="Mode" style={{ marginBottom: 10 }}>
          <button type="button" role="tab" aria-selected={!sub} className={!sub ? 'active' : ''} onClick={() => patch({ mode: 'match' })}>Match</button>
          <button type="button" role="tab" aria-selected={sub} className={sub ? 'active' : ''} onClick={() => patch({ mode: 'sub' })}>Substitution</button>
        </div>
        {sub && (
          <div className="m-fld" style={{ marginBottom: 10 }}>
            <label>Replace with</label>
            <input className="m-rx-pattern" value={s.subReplacement} onChange={e => patch({ subReplacement: e.target.value })}
              placeholder="$1 at $2" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Replacement"/>
            <div className="m-hint">$1, $2 use capture groups; $&amp; is the whole match. See Reference.</div>
          </div>
        )}

        <div className="m-fld" style={{ marginBottom: 12 }}>
          <label>Test text</label>
          <div className="m-filters" style={{ marginBottom: 8 }}>
            <select className="m-select" aria-label="Sample" value={s.tcIndex} onChange={e => { patch({ tcIndex: Number(e.target.value) }); setSel(-1); }}>
              {s.testCases.map((c, i) => <option key={i} value={i}>{c.name || `Sample ${i + 1}`}</option>)}
            </select>
            <button type="button" className="btn m-btn-lg" aria-label="Add sample" onClick={() => setAddSample('')}><Icon name="plus" size={14}/> Sample</button>
          </div>
          <textarea className="m-docs-text short" value={tc.content} onChange={e => setTestText(e.target.value)} spellCheck={false} aria-label="Test text"/>
        </div>

        {sub && replaced != null && (
          <div className="m-fld" style={{ marginBottom: 12 }}>
            <label>Result</label>
            <div className="m-rx-text" aria-label="Replaced text">{replaced || ' '}</div>
          </div>
        )}

        <div className="m-seg" role="tablist" aria-label="Details" style={{ marginBottom: 10 }}>
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'matches' && (
          <>
            {s.pattern && !err
              ? <Highlighted text={tc.content} matches={matches} sel={sel}/>
              : <div className="m-hint">{err ? 'Fix the pattern to see matches.' : 'Type a pattern above to see matches highlighted in the text.'}</div>}
            {matches.length > 0 && (
              <div className="m-card flush" style={{ marginTop: 10 }}>
                {matches.slice(0, 100).map((m, i) => (
                  <div key={i} className={`m-row${i === sel ? ' on' : ''}`} onClick={() => setSel(i === sel ? -1 : i)}>
                    <div className="m-row-main">
                      <div className="m-row-title mono" style={{ wordBreak: 'break-all' }}>{m.value || '(empty)'}</div>
                      <div className="m-row-sub">match {i + 1} · at {m.index} · {m.value.length} chars</div>
                      {groupLines(m).length > 0 && (
                        <div className="m-rx-groups">
                          {groupLines(m).map((g, gi) => (
                            <div key={gi}><span className="k" style={{ color: GROUP_COLORS[gi % GROUP_COLORS.length] }}>{g.label}</span><span className="v">{g.value ?? '∅'}</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {matches.length > 100 && <div className="m-row-sub" style={{ padding: 12 }}>and {matches.length - 100} more</div>}
              </div>
            )}
          </>
        )}

        {tab === 'code' && (
          <>
            <div className="m-filters">
              <select className="m-select" aria-label="Language" value={lang} onChange={e => setLang(e.target.value)}>
                {LANGS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <button type="button" className="btn m-btn-lg" disabled={!code} onClick={() => { copy(code); onFlash?.(`Copied ${lang} code`); }}>
                <Icon name="copy" size={14}/> Copy
              </button>
            </div>
            {code ? <pre className="m-rx-code">{code}</pre> : <div className="m-hint">Enter a valid pattern to generate code.</div>}
          </>
        )}

        {tab === 'tests' && (
          <>
            <div className="m-hint" style={{ marginTop: 0, marginBottom: 8 }}>Check the pattern against strings that should, or should not, match.</div>
            {unitResults.length === 0 && <div className="m-hint">No tests yet.</div>}
            {unitResults.length > 0 && (
              <div className="m-card flush">
                {unitResults.map((t, i) => (
                  <div key={i} className="m-row" style={{ cursor: 'default' }}>
                    <span className={`pill ${t.result === 'pass' ? 'success' : t.result === 'fail' ? 'danger' : ''}`}>{t.result}</span>
                    <div className="m-row-main">
                      <div className="m-row-title mono" style={{ wordBreak: 'break-all' }}>{t.str}</div>
                      <div className="m-row-sub">should {t.expectMatch ? 'match' : 'not match'}</div>
                    </div>
                    <button type="button" className="m-iconbtn" aria-label={`Delete test ${t.str}`}
                      onClick={() => patch({ unitTests: s.unitTests.filter((_, k) => k !== i) })}><Icon name="trash" size={16}/></button>
                  </div>
                ))}
              </div>
            )}
            <div className="m-fld" style={{ marginTop: 12 }}>
              <label>Add a test</label>
              <input value={newTest.str} onChange={e => setNewTest(n => ({ ...n, str: e.target.value }))} placeholder="Text to check" aria-label="Test string"
                spellCheck={false} autoCapitalize="off" autoCorrect="off" onKeyDown={e => { if (e.key === 'Enter') addUnit(); }}/>
              <div className="m-seg" style={{ marginTop: 8 }}>
                <button type="button" className={newTest.expectMatch ? 'active' : ''} onClick={() => setNewTest(n => ({ ...n, expectMatch: true }))}>Should match</button>
                <button type="button" className={!newTest.expectMatch ? 'active' : ''} onClick={() => setNewTest(n => ({ ...n, expectMatch: false }))}>Should not match</button>
              </div>
              <button type="button" className="btn primary m-btn-lg" style={{ marginTop: 8 }} disabled={!newTest.str.trim()} onClick={addUnit}>Add test</button>
            </div>
          </>
        )}

        {tab === 'ref' && (
          <>
            <div className="m-search" style={{ marginBottom: 10 }}>
              <span className="si"><Icon name="search" size={16}/></span>
              <input type="search" value={refFilter} onChange={e => setRefFilter(e.target.value)} placeholder="Search the reference" aria-label="Search the reference"/>
            </div>
            <div className="m-hint" style={{ marginTop: 0, marginBottom: 6 }}>Tap an entry to add it to the {sub ? 'pattern or replacement' : 'pattern'}.</div>
            {refSections.length === 0 && <div className="m-hint">Nothing matches.</div>}
            {refSections.map(sec => (
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
          </>
        )}
      </ToolFrame>

      <DocsSheet open={docsSheet} onClose={() => setDocsSheet(false)} docs={d.docs} currentDocId={d.currentDocId} name="regex documents"
        onOpen={d.openDoc} onNew={() => d.newDoc()} onRename={d.renameDoc} onDelete={d.deleteDoc}/>

      <Sheet open={addSample !== null} icon="plus" title="New sample" sub="A piece of text to test the pattern against" onClose={() => setAddSample(null)}
        footer={<button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={addSampleCase}>Add sample</button>}>
        <div className="m-fld">
          <label>Name</label>
          <input autoFocus value={addSample || ''} onChange={e => setAddSample(e.target.value)} placeholder={`Sample ${s.testCases.length + 1}`}
            aria-label="Sample name" onKeyDown={e => { if (e.key === 'Enter') addSampleCase(); }}/>
        </div>
      </Sheet>
    </>
  );
}
