// md-phone.jsx — Markdown on a phone: Edit or Preview (one pane at a time), a formatting strip that
// sits above the keyboard, autosave into the same `md_documents` store the desktop layout uses, and
// Export. Opens on the most recently edited document.
import React from 'react';
import { MarkdownPreview, generateId } from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { pickerAdapter } from '../adapters/picker.js';
import { ToolFrame, DocsSheet } from './docs-frame.jsx';

const KEY = 'md_documents';
const loadDocs = () => {
  try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return Array.isArray(p.docs) ? p.docs : []; } catch { return []; }
};
const saveDocs = (docs) => { try { localStorage.setItem(KEY, JSON.stringify({ docs })); } catch { /* storage full */ } };
// A document is named by its first # heading, as on the desktop.
export const autoNameOf = (content) => { const m = String(content).match(/^#\s+(.+)/m); return m ? m[1].trim().slice(0, 80) : 'Untitled'; };
export const wordCount = (t) => (String(t).trim() ? String(t).trim().split(/\s+/).length : 0);

// What each formatting chip inserts around the selection (the same set as the desktop toolbar).
export const FORMATS = [
  { label: 'B', title: 'Bold', before: '**', after: '**', ph: 'bold text' },
  { label: 'I', title: 'Italic', before: '*', after: '*', ph: 'italic text' },
  { label: 'S', title: 'Strikethrough', before: '~~', after: '~~', ph: 'text' },
  { label: '</>', title: 'Inline code', before: '`', after: '`', ph: 'code' },
  { label: 'H1', title: 'Heading 1', before: '\n# ', after: '', ph: 'Heading 1' },
  { label: 'H2', title: 'Heading 2', before: '\n## ', after: '', ph: 'Heading 2' },
  { label: 'H3', title: 'Heading 3', before: '\n### ', after: '', ph: 'Heading 3' },
  { label: '•', title: 'Bullet list', before: '\n- ', after: '', ph: 'list item' },
  { label: '1.', title: 'Numbered list', before: '\n1. ', after: '', ph: 'list item' },
  { label: '☐', title: 'Task', before: '\n- [ ] ', after: '', ph: 'task' },
  { label: '❝', title: 'Quote', before: '\n> ', after: '', ph: 'quote' },
  { label: 'Link', title: 'Link', before: '[', after: '](url)', ph: 'link text' },
  { label: 'Image', title: 'Image', before: '![', after: '](image-url)', ph: 'alt text' },
  { label: 'Code', title: 'Code block', before: '\n```\n', after: '\n```\n', ph: 'code here' },
  { label: 'Table', title: 'Table', before: '\n| Col | Col | Col |\n| --- | --- | --- |\n| ', after: ' |  |  |\n', ph: '' },
  { label: '—', title: 'Divider', before: '\n---\n', after: '', ph: '' },
];

// Wraps the selected text (or the placeholder) and says where the selection should land after.
export function applyFormat(text, start, end, f) {
  const sel = text.slice(start, end) || f.ph;
  const next = text.slice(0, start) + f.before + sel + f.after + text.slice(end);
  const from = start + f.before.length;
  return { next, from, to: from + sel.length };
}

function useMdDocs() {
  const [docs, setDocs] = React.useState(loadDocs);
  const latest = React.useMemo(() => [...docs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0], []); // eslint-disable-line react-hooks/exhaustive-deps
  const [content, setContent] = React.useState(latest?.content || '');
  const [currentId, setCurrentId] = React.useState(latest?.id || null);
  const [status, setStatus] = React.useState('');
  const skip = React.useRef(true); // the first value is what we loaded, not an edit
  const docsRef = React.useRef(docs); docsRef.current = docs;
  const timer = React.useRef(null);

  const commit = (next) => { docsRef.current = next; setDocs(next); saveDocs(next); };

  React.useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    clearTimeout(timer.current);
    if (!content.trim()) { setStatus(''); return; }
    setStatus('saving');
    timer.current = setTimeout(() => {
      const now = Date.now();
      if (currentId && docsRef.current.some(d => d.id === currentId)) {
        commit(docsRef.current.map(d => (d.id === currentId ? { ...d, content, autoName: autoNameOf(content), updatedAt: now } : d)));
      } else {
        const id = generateId();
        commit([...docsRef.current, { id, name: null, autoName: autoNameOf(content), content, createdAt: now, updatedAt: now }]);
        setCurrentId(id);
      }
      setStatus('saved');
    }, 500);
    return () => clearTimeout(timer.current);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = (id, text) => { clearTimeout(timer.current); skip.current = true; setCurrentId(id); setContent(text); setStatus(''); };
  return {
    docs, content, setContent, currentId, status,
    open: (id) => { const d = docsRef.current.find(x => x.id === id); if (d) load(id, d.content); },
    create: () => load(null, ''),
    remove: (id) => { commit(docsRef.current.filter(d => d.id !== id)); if (id === currentId) load(null, ''); },
    rename: (id, name) => commit(docsRef.current.map(d => (d.id === id ? { ...d, name: name && name !== d.autoName ? name : null } : d))),
  };
}

export function MarkdownPhone({ tool, setTool, onFlash }) {
  const m = useMdDocs();
  const [mode, setMode] = React.useState('edit');
  const [sheet, setSheet] = React.useState(false);
  const ta = React.useRef(null);
  const current = m.docs.find(d => d.id === m.currentId);
  const title = current ? (current.name ?? current.autoName) : 'New document';

  const format = (f) => {
    const el = ta.current; if (!el) return;
    const { next, from, to } = applyFormat(m.content, el.selectionStart, el.selectionEnd, f);
    m.setContent(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(from, to); });
  };
  const exportDoc = async () => {
    if (!m.content.trim()) { onFlash?.('Nothing to export yet'); return; }
    const name = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    try {
      if (navigator.share) await navigator.share({ title: name, text: m.content });
      else { await pickerAdapter.saveFile(name, m.content); onFlash?.('Exported'); }
    } catch { /* cancelled */ }
  };

  const status = m.status === 'saving' ? 'Saving…' : m.status === 'saved' ? 'Saved' : '';
  return (
    <>
      <ToolFrame sub={title} tool={tool} setTool={setTool} onDocs={() => setSheet(true)} onNew={() => { m.create(); setMode('edit'); }}
        actions={<button type="button" className="m-iconbtn" aria-label="Export" onClick={exportDoc}><Icon name="send" size={17}/></button>}
        footer={(
          <div className="m-docs-foot">
            <span>{wordCount(m.content).toLocaleString()} words · {m.content ? m.content.split('\n').length : 0} lines</span>
            <span className="m-docs-status">{status}</span>
          </div>
        )}>
        <div className="m-seg" style={{ margin: '0 0 10px' }}>
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button>
        </div>
        {mode === 'edit' ? (
          <>
            <textarea ref={ta} className="m-docs-text" value={m.content} onChange={e => m.setContent(e.target.value)}
              placeholder={'# Start writing…\n\nPaste markdown here.'} spellCheck={false} aria-label="Markdown"/>
            <div className="m-fmtbar" role="toolbar" aria-label="Formatting">
              {FORMATS.map(f => (
                <button key={f.title} type="button" title={f.title} aria-label={f.title}
                  onMouseDown={e => e.preventDefault()} onClick={() => format(f)}>{f.label}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="m-docs-preview">
            {m.content.trim() ? <MarkdownPreview markdown={m.content} ctrlWheel={false}/> : <div className="muted">Nothing to preview yet.</div>}
          </div>
        )}
      </ToolFrame>
      <DocsSheet open={sheet} onClose={() => setSheet(false)} docs={m.docs} currentDocId={m.currentId} name="Markdown documents"
        onOpen={(id) => { m.open(id); setMode('edit'); }} onNew={() => { m.create(); setMode('edit'); }} onRename={m.rename} onDelete={m.remove}/>
    </>
  );
}
