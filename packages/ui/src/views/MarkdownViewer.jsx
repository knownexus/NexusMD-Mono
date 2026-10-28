// MarkdownViewer.jsx — shared markdown document editor/viewer (web + app).
// Integrates with the host theme (CSS tokens + data-theme), so it has no built-in
// dark toggle. marked is imported from npm; highlight.js is still loaded on demand
// via CDN. Self-contained — no app-local imports.
import React from 'react';
import { marked, Marked } from 'marked';
import DOMPurify from 'dompurify';
import { isDarkPalette } from '../themes.js';
const { useState: useStateMD, useEffect: useEffectMD, useRef: useRefMD, useCallback: useCallbackMD } = React;

const HLJS_LIGHT = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css";
const HLJS_DARK  = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css";
const STORAGE_KEY = 'md_documents';
const CHEAT_OPEN_KEY     = 'md_cheatsheet_open';
const LEARN_MODE_KEY     = 'md_learn_mode';
const PROGRESS_KEY       = 'md_learning_progress';

function loadLearningProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

const TRACKABLE_ELEMENTS = {
  heading:        'h1, h2, h3, h4, h5, h6',
  bold:           'strong',
  italic:         'em',
  strikethrough:  'del',
  'inline-code':  'p > code, li > code',
  blockquote:     'blockquote',
  hr:             'hr',
  'bullet-list':  'ul:not(.contains-task-list)',
  'numbered-list':'ol',
  'task-list':    'li.task-list-item',
  link:           'a[href]',
  image:          'img',
  'code-block':   'pre',
  table:          'table',
};

const CHEAT_GROUPS = [
  {
    label: 'Text Formatting',
    items: [
      { label: 'Bold',          learnKey: 'bold',          syntax: '**text**',        description: 'Make text bold',                           before: '**',        after: '**',         placeholder: 'bold text',       inline: true  },
      { label: 'Italic',        learnKey: 'italic',        syntax: '*text*',           description: 'Make text italic',                         before: '*',         after: '*',          placeholder: 'italic text',     inline: true  },
      { label: 'Strikethrough', learnKey: 'strikethrough', syntax: '~~text~~',         description: 'Strike through text',                      before: '~~',        after: '~~',         placeholder: 'strikethrough',   inline: true  },
      { label: 'Inline Code',   learnKey: 'inline-code',   syntax: '`code`',           description: 'Inline code or variable names',            before: '`',         after: '`',          placeholder: 'code',            inline: true  },
    ],
  },
  {
    label: 'Structure',
    items: [
      { label: 'H1',            learnKey: 'heading',       syntax: '# Heading 1',      description: 'Top-level heading',                        before: '\n# ',      after: '',           placeholder: 'Heading 1',       inline: false },
      { label: 'H2',            learnKey: 'heading',       syntax: '## Heading 2',     description: 'Second-level heading',                     before: '\n## ',     after: '',           placeholder: 'Heading 2',       inline: false },
      { label: 'H3',            learnKey: 'heading',       syntax: '### Heading 3',    description: 'Third-level heading',                      before: '\n### ',    after: '',           placeholder: 'Heading 3',       inline: false },
      { label: 'Blockquote',    learnKey: 'blockquote',    syntax: '> text',           description: 'Indented quote block',                     before: '\n> ',      after: '',           placeholder: 'blockquote text', inline: false },
      { label: 'Horiz. Rule',   learnKey: 'hr',            syntax: '---',              description: 'Horizontal divider line',                  before: '\n---\n',   after: '',           placeholder: '',                inline: false },
    ],
  },
  {
    label: 'Lists',
    items: [
      { label: '• Bullet List', learnKey: 'bullet-list',   syntax: '- item',           description: 'Unordered list item',                      before: '\n- ',      after: '',           placeholder: 'list item',       inline: false },
      { label: '1. Numbered',   learnKey: 'numbered-list', syntax: '1. item',          description: 'Ordered list item',                        before: '\n1. ',     after: '',           placeholder: 'list item',       inline: false },
      { label: '☐ Task',        learnKey: 'task-list',     syntax: '- [ ] task',       description: 'Checkbox task item',                       before: '\n- [ ] ', after: '',           placeholder: 'task item',       inline: false },
    ],
  },
  {
    label: 'Links & Media',
    items: [
      { label: 'Link',          learnKey: 'link',          syntax: '[text](url)',       description: 'Clickable hyperlink',                      before: '[',         after: '](url)',     placeholder: 'link text',       inline: true  },
      { label: 'Image',         learnKey: 'image',         syntax: '![alt](url)',       description: 'Embedded image',                           before: '![',        after: '](image-url)', placeholder: 'alt text',     inline: true  },
    ],
  },
  {
    label: 'Code',
    items: [
      { label: 'Code Block',    learnKey: 'code-block',    syntax: '```lang\ncode\n```', description: 'Fenced code block with syntax highlighting', before: '\n```\n', after: '\n```\n',  placeholder: 'code here',       inline: false },
    ],
  },
  {
    label: 'Table',
    items: [
      { label: 'Table',         learnKey: 'table',         syntax: '| Col | Col |',    description: '3-column table with header row',
        before: '\n| Header | Header | Header |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n',
        after: '', placeholder: '', inline: false },
    ],
  },
];

// ── Storage helpers ────────────────────────────────────────────────

function loadDocs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch { return []; }
}

function saveDocs(docs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs }));
}

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function extractAutoName(content) {
  const m = content.match(/^#\s+(.+)/m);
  return m ? m[1].trim().slice(0, 80) : 'Untitled';
}

export function displayName(doc) {
  return doc.name ?? doc.autoName;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function parseMarkdownSafe(content) {
  try {
    const raw = new Marked({ gfm: true }).parse(content || '');
    return DOMPurify ? DOMPurify.sanitize(raw) : raw;
  } catch { return ''; }
}

function docWordCount(content) {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}

// ── useScript ────────────────────────────────────────────────────

function useScript(src) {
  const [ready, setReady] = useStateMD(false);
  useEffectMD(() => {
    if (document.querySelector(`script[src="${src}"]`)) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [src]);
  return ready;
}

// ── DocumentsModal ───────────────────────────────────────────────

function DocumentsModal({ docs, currentDocId, markedReady, hasUnsavedContent, onOpen, onNew, onDelete, onRename, onClose }) {
  const [renamingId, setRenamingId]           = useStateMD(null);
  const [renameValue, setRenameValue]         = useStateMD('');
  const [confirmDeleteId, setConfirmDeleteId] = useStateMD(null);
  const [pendingOpenId, setPendingOpenId]     = useStateMD(null);

  const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);

  function handleCardClick(doc) {
    if (doc.id === currentDocId) { onClose(); return; }
    if (hasUnsavedContent) { setPendingOpenId(doc.id); return; }
    onOpen(doc.id);
  }

  function startRename(e, doc) {
    e.stopPropagation();
    setRenamingId(doc.id);
    setRenameValue(doc.name ?? doc.autoName);
    setConfirmDeleteId(null);
  }

  function commitRename(id) {
    const val = renameValue.trim();
    const doc = docs.find(d => d.id === id);
    // if the user typed the same as the auto-name, clear the custom name
    onRename(id, (doc && val === doc.autoName) ? null : (val || null));
    setRenamingId(null);
  }

  function startDelete(e, id) {
    e.stopPropagation();
    setConfirmDeleteId(id);
    setRenamingId(null);
  }

  const iconBtnStyle = {
    width: 26, height: 26, borderRadius: 4,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, padding: 0, flexShrink: 0,
  };

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 16px', overflowY: 'auto',
        }}
        onClick={onClose}
      >
        <div
          style={{
            width: '100%', maxWidth: 880,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Documents
              {docs.length > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>
                  ({docs.length})
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={onNew}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  border: '1px solid var(--accent)', background: 'var(--accent)',
                  color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >+ New Document</button>
              <button
                onClick={onClose}
                style={{
                  ...iconBtnStyle, width: 30, height: 30,
                  fontSize: 18, color: 'var(--text-muted)', border: '1px solid var(--border)',
                }}
              >×</button>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: 20 }}>
            {docs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-subtle)', fontSize: 13 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
                  style={{ display: 'block', margin: '0 auto 12px', opacity: .4 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>No saved documents yet.</p>
                <p style={{ marginTop: 4 }}>Start typing to create one.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16,
              }}>
                {sorted.map(doc => {
                  const isActive   = doc.id === currentDocId;
                  const isRenaming = renamingId === doc.id;
                  const isDeleting = confirmDeleteId === doc.id;
                  const html       = markedReady ? parseMarkdownSafe(doc.content) : '';

                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleCardClick(doc)}
                      style={{
                        position: 'relative', borderRadius: 8, overflow: 'hidden',
                        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        background: 'var(--bg)', cursor: 'pointer',
                        transition: 'border-color .15s',
                      }}
                    >
                      {/* Action buttons */}
                      <div
                        style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}
                        onClick={e => e.stopPropagation()}
                      >
                        {isDeleting ? (
                          <>
                            <button
                              style={{ ...iconBtnStyle, color: '#ef4444', borderColor: '#ef4444', padding: '0 8px', width: 'auto', gap: 4, fontSize: 11 }}
                              onClick={e => { e.stopPropagation(); onDelete(doc.id); setConfirmDeleteId(null); }}
                            >Delete?</button>
                            <button
                              style={iconBtnStyle}
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            >✕</button>
                          </>
                        ) : (
                          <>
                            <button style={iconBtnStyle} title="Rename" onClick={e => startRename(e, doc)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M11 2l3 3L5 14H2v-3L11 2z"/>
                              </svg>
                            </button>
                            <button style={{ ...iconBtnStyle, color: '#ef4444' }} title="Delete" onClick={e => startDelete(e, doc.id)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <polyline points="2 4 14 4"/>
                                <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
                                <path d="M3 4l1 10h8l1-10"/>
                              </svg>
                            </button>
                          </>
                        )}
                      </div>

                      {/* Mini preview thumbnail */}
                      <div style={{
                        height: 160, overflow: 'hidden', position: 'relative',
                        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
                      }}>
                        {html ? (
                          <div
                            className="md-content"
                            dangerouslySetInnerHTML={{ __html: html }}
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: 680, padding: '16px 20px',
                              transform: 'scale(0.35)', transformOrigin: 'top left',
                              pointerEvents: 'none', userSelect: 'none',
                            }}
                          />
                        ) : (
                          <div style={{
                            height: '100%', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 11,
                          }}>
                            {doc.content ? 'Loading…' : 'Empty document'}
                          </div>
                        )}
                      </div>

                      {/* Name + meta */}
                      <div style={{ padding: '10px 12px 12px' }}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(doc.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(doc.id); }
                              if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); }
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%', border: '1px solid var(--accent)',
                              borderRadius: 4, padding: '3px 7px',
                              background: 'var(--surface)', color: 'var(--text)',
                              fontSize: 12, fontWeight: 600, outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        ) : (
                          <div style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            paddingRight: 58,
                          }}>
                            {displayName(doc)}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                          {docWordCount(doc.content).toLocaleString()} words · {relativeTime(doc.updatedAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Discard confirmation — rendered above the modal overlay */}
      {pendingOpenId !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '28px 32px', maxWidth: 360, width: '100%',
            margin: '0 16px', textAlign: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,.25)',
          }}>
            <p style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              You have unsaved content. Open this document anyway?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                }}
                onClick={() => setPendingOpenId(null)}
              >Cancel</button>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: 'none', background: 'var(--accent)',
                  color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
                onClick={() => { onOpen(pendingOpenId); setPendingOpenId(null); }}
              >Open anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── annotatePreview ───────────────────────────────────────────────

function annotatePreview(container) {
  const rules = [
    { sel: 'h1',                   src: el => `# ${el.textContent.trim()}` },
    { sel: 'h2',                   src: el => `## ${el.textContent.trim()}` },
    { sel: 'h3',                   src: el => `### ${el.textContent.trim()}` },
    { sel: 'h4',                   src: el => `#### ${el.textContent.trim()}` },
    { sel: 'h5',                   src: el => `##### ${el.textContent.trim()}` },
    { sel: 'h6',                   src: el => `###### ${el.textContent.trim()}` },
    { sel: 'strong',               src: el => `**${el.textContent.trim()}**` },
    { sel: 'em',                   src: el => `*${el.textContent.trim()}*` },
    { sel: 'del',                  src: el => `~~${el.textContent.trim()}~~` },
    { sel: 'p > code, li > code',  src: el => `\`${el.textContent}\`` },
    { sel: 'blockquote',           src: el => `> ${el.textContent.trim().split('\n')[0].trim()}` },
    { sel: 'a[href]',              src: el => `[${el.textContent.trim()}](${el.getAttribute('href')})` },
    { sel: 'img',                  src: el => `![${el.alt}](${el.getAttribute('src')})` },
    { sel: 'pre',                  src: el => {
        const lang = el.getAttribute('data-lang') || '';
        const code = el.querySelector('code')?.textContent?.trim() || '';
        return `\`\`\`${lang}\n${code.slice(0, 60)}${code.length > 60 ? '…' : ''}\n\`\`\``;
      }
    },
    { sel: 'table',                src: () => '| Col | Col |\n| --- | --- |' },
    { sel: 'hr',                   src: () => '---' },
    { sel: 'li.task-list-item',    src: el => {
        const checked = el.querySelector('input[type="checkbox"]')?.checked;
        return `- [${checked ? 'x' : ' '}] ${el.textContent.trim()}`;
      }
    },
    { sel: 'ul:not(.contains-task-list)', src: () => '- item\n- item' },
    { sel: 'ol',                          src: () => '1. item\n2. item' },
  ];

  rules.forEach(({ sel, src }) => {
    container.querySelectorAll(sel).forEach(el => {
      try { el.setAttribute('data-md-source', src(el)); } catch {}
    });
  });
}

// ── CheatSheetPanel ──────────────────────────────────────────────

function CheatSheetPanel({ filter, onFilterChange, learningProgress, onInsert, onClose }) {
  const totalElements = Object.keys(TRACKABLE_ELEMENTS).length;
  const masteredCount = Object.values(learningProgress).filter(Boolean).length;

  const filtered = filter.trim().toLowerCase();
  const visibleGroups = CHEAT_GROUPS.map(g => ({
    ...g,
    items: filtered
      ? g.items.filter(i =>
          i.label.toLowerCase().includes(filtered) ||
          i.description.toLowerCase().includes(filtered) ||
          i.syntax.toLowerCase().includes(filtered)
        )
      : g.items,
  })).filter(g => g.items.length > 0);

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0,
      width: 300, height: '100%',
      background: 'var(--surface)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 10,
      boxShadow: '-4px 0 16px rgba(0,0,0,.1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}>Cheat Sheet</span>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{masteredCount}/{totalElements}</span>
        <button
          onClick={onClose}
          style={{
            width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, padding: 0,
          }}
        >×</button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Filter elements…"
          value={filter}
          onChange={e => onFilterChange(e.target.value)}
          style={{
            width: '100%', padding: '5px 8px', borderRadius: 4,
            border: '1px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Groups */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {visibleGroups.map(group => (
          <div key={group.label} style={{ marginBottom: 8 }}>
            <div style={{
              padding: '4px 12px 2px', fontSize: 10, fontWeight: 700,
              letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-subtle)',
            }}>
              {group.label}
            </div>
            {group.items.map(item => {
              const learned = !!learningProgress[item.learnKey];
              return (
                <div
                  key={item.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 12px',
                    opacity: learned ? 1 : 0.6,
                    transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => { if (!learned) e.currentTarget.style.opacity = '0.85'; }}
                  onMouseLeave={e => { if (!learned) e.currentTarget.style.opacity = '0.6'; }}
                >
                  {/* Checkmark */}
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: learned ? '#22c55e' : 'var(--border-strong)', fontSize: 11,
                  }}>
                    {learned ? '✓' : '○'}
                  </span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>{item.label}</span>
                      <code style={{
                        fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Cascadia Code', Consolas, monospace",
                        background: 'var(--bg)', borderRadius: 3, padding: '0 4px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
                        display: 'inline-block', verticalAlign: 'bottom',
                      }} title={item.syntax}>{item.syntax}</code>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 1 }}>{item.description}</div>
                  </div>

                  {/* Insert button */}
                  <button
                    onClick={() => onInsert(item)}
                    title="Insert example"
                    style={{
                      flexShrink: 0, padding: '2px 7px', borderRadius: 4, fontSize: 10,
                      border: '1px solid var(--border)', background: 'var(--bg)',
                      color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >↩</button>
                </div>
              );
            })}
          </div>
        ))}

        {visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-subtle)', fontSize: 11 }}>
            No elements match "{filter}"
          </div>
        )}
      </div>
    </div>
  );
}

// ── MarkdownToolbar ──────────────────────────────────────────────

function MarkdownToolbar({ onInsert }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '4px 8px', flexShrink: 0, flexWrap: 'wrap',
      background: 'var(--surface)', borderBottom: '1px solid var(--border)',
    }}>
      {CHEAT_GROUPS.map((group, gi) => (
        <React.Fragment key={group.label}>
          {gi > 0 && (
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
          )}
          {group.items.map(item => (
            <button
              key={item.label}
              title={item.syntax}
              onClick={() => onInsert(item)}
              style={{
                padding: '3px 8px', borderRadius: 4,
                border: '1px solid transparent', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 11, fontWeight: 500,
                cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'background .12s, color .12s, border-color .12s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg)';
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              {item.label}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── MarkdownViewer ────────────────────────────────────────────────

function MarkdownViewer() {
  const [markdown, setMarkdown]         = useStateMD('');
  const [view, setView]                 = useStateMD("split");
  const [copyVisible, setCopyVisible]   = useStateMD(false);
  const [dragOver, setDragOver]         = useStateMD(false);
  const [editorWidth, setEditorWidth]   = useStateMD(null);

  // Document state
  const [docs, setDocs]                 = useStateMD(loadDocs);
  const [currentDocId, setCurrentDocId] = useStateMD(null);
  const [showModal, setShowModal]       = useStateMD(false);
  const [saveStatus, setSaveStatus]     = useStateMD('');
  const [learnMode, setLearnMode]           = useStateMD(() => localStorage.getItem(LEARN_MODE_KEY) === 'true');
  const [cheatSheetOpen, setCheatSheetOpen] = useStateMD(() => localStorage.getItem(CHEAT_OPEN_KEY) === 'true');
  const [learningProgress, setLearningProgress] = useStateMD(loadLearningProgress);
  const [cheatSheetFilter, setCheatSheetFilter] = useStateMD('');

  const editorRef    = useRefMD(null);
  const previewRef   = useRefMD(null);
  const workspaceRef = useRefMD(null);
  const fileInputRef = useRefMD(null);
  const hljsLinkRef  = useRefMD(null);
  const tooltipRef   = useRefMD(null);
  const dragging     = useRefMD(false);
  const startX       = useRefMD(0);
  const startW       = useRefMD(0);

  // Auto-save refs
  const saveTimerRef       = useRefMD(null);
  const createDocTimerRef  = useRefMD(null);
  const saveStatusTimerRef = useRefMD(null);
  const markdownRef        = useRefMD('');
  const isLoadingDoc       = useRefMD(false);

  const markedReady = true; // marked is imported from npm (no CDN script needed)
  const hljsReady   = useScript("https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js");

  // Keep markdownRef in sync for use inside async timer callbacks
  useEffectMD(() => { markdownRef.current = markdown; }, [markdown]);

  // Persist learnMode to localStorage
  useEffectMD(() => { localStorage.setItem(LEARN_MODE_KEY, learnMode); }, [learnMode]);

  // Persist cheatSheetOpen to localStorage
  useEffectMD(() => { localStorage.setItem(CHEAT_OPEN_KEY, cheatSheetOpen); }, [cheatSheetOpen]);

  // Inject / update highlight.js CSS link — mirrors the app's active theme
  useEffectMD(() => {
    const getHref = () => isDarkPalette(document.body.dataset.theme) ? HLJS_DARK : HLJS_LIGHT;

    if (!hljsLinkRef.current) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.id  = "hljs-theme";
      document.head.appendChild(link);
      hljsLinkRef.current = link;
    }
    hljsLinkRef.current.href = getHref();

    const observer = new MutationObserver(() => {
      if (hljsLinkRef.current) hljsLinkRef.current.href = getHref();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Render markdown into preview div
  useEffectMD(() => {
    if (!markedReady || !hljsReady || !previewRef.current) return;
    const { hljs } = window;
    if (!hljs) return;
    const md2html = new Marked({ gfm: true });
    const raw = md2html.parse(markdown);
    previewRef.current.innerHTML = DOMPurify.sanitize(raw);
    previewRef.current.querySelectorAll('pre code[class*="language-"]').forEach(block => {
      hljs.highlightElement(block);
      const lang = (block.className.match(/language-(\S+)/) || [])[1];
      if (lang) block.closest("pre").setAttribute("data-lang", lang);
    });
  }, [markdown, markedReady, hljsReady]);

  // Auto-save: fires on content or active doc change
  useEffectMD(() => {
    // Skip when we programmatically loaded a document (not a user edit)
    if (isLoadingDoc.current) { isLoadingDoc.current = false; return; }

    clearTimeout(saveTimerRef.current);
    clearTimeout(createDocTimerRef.current);

    if (!markdown) { setSaveStatus(''); return; }

    if (currentDocId) {
      setSaveStatus('saving');
      saveTimerRef.current = setTimeout(() => {
        const content = markdownRef.current;
        let ok = true;
        setDocs(prev => {
          const next = prev.map(d => d.id === currentDocId
            ? { ...d, content, autoName: extractAutoName(content), updatedAt: Date.now() }
            : d
          );
          try { saveDocs(next); } catch { ok = false; return prev; }
          return next;
        });
        if (ok) {
          setSaveStatus('saved');
          clearTimeout(saveStatusTimerRef.current);
          saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
        } else {
          setSaveStatus('error');
        }
      }, 300);
    } else {
      setSaveStatus('unsaved');
      createDocTimerRef.current = setTimeout(() => {
        const content = markdownRef.current;
        if (!content) return;
        const newDoc = {
          id: generateId(), name: null,
          autoName: extractAutoName(content), content,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        let ok = true;
        setCurrentDocId(newDoc.id);
        setDocs(prev => {
          const next = [...prev, newDoc];
          try { saveDocs(next); } catch { ok = false; return prev; }
          return next;
        });
        if (ok) {
          setSaveStatus('saved');
          clearTimeout(saveStatusTimerRef.current);
          saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
        } else {
          setSaveStatus('error');
        }
      }, 1500);
    }

    return () => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(createDocTimerRef.current);
    };
  }, [markdown, currentDocId]);

  // Cleanup timers on unmount
  useEffectMD(() => () => {
    clearTimeout(saveTimerRef.current);
    clearTimeout(createDocTimerRef.current);
    clearTimeout(saveStatusTimerRef.current);
  }, []);

  // Create tooltip element for Learn Mode
  useEffectMD(() => {
    const tip = document.createElement('div');
    tip.style.cssText = [
      'position:fixed', 'z-index:9999', 'pointer-events:none',
      'background:rgba(0,0,0,.88)', 'color:#e8eaf0',
      "font-family:'Cascadia Code',Consolas,monospace",
      'font-size:11px', 'line-height:1.5', 'padding:4px 9px',
      'border-radius:5px', 'white-space:pre', 'max-width:340px',
      'border:1px solid rgba(255,255,255,.13)', 'display:none',
    ].join(';');
    document.body.appendChild(tip);
    tooltipRef.current = tip;
    return () => { tip.remove(); tooltipRef.current = null; };
  }, []);

  // Learn Mode annotation effect
  useEffectMD(() => {
    const container = previewRef.current;
    const tip = tooltipRef.current;
    if (!container) return;

    container.querySelectorAll('[data-md-source]').forEach(el => {
      el.removeAttribute('data-md-source');
      el.style.outline = '';
      el.style.cursor = '';
    });
    if (tip) tip.style.display = 'none';

    if (!learnMode || !markedReady || !hljsReady) return;

    annotatePreview(container);

    const onOver = (e) => {
      const el = e.target.closest('[data-md-source]');
      if (!el || !tip) return;
      tip.textContent = el.getAttribute('data-md-source');
      tip.style.display = 'block';
      const r = el.getBoundingClientRect();
      const tipH = tip.offsetHeight || 28;
      const topAbove = r.top - tipH - 6;
      tip.style.left = `${Math.max(4, r.left)}px`;
      tip.style.top  = `${topAbove < 4 ? r.bottom + 4 : topAbove}px`;
    };
    const onOut = () => { if (tip) tip.style.display = 'none'; };

    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseout', onOut);
    container.style.cursor = 'default';

    return () => {
      container.removeEventListener('mouseover', onOver);
      container.removeEventListener('mouseout', onOut);
      container.style.cursor = '';
      if (tip) tip.style.display = 'none';
    };
  }, [learnMode, markdown, markedReady, hljsReady]);

  // Progress tracking effect
  useEffectMD(() => {
    if (!previewRef.current || !markedReady || !hljsReady) return;
    const container = previewRef.current;
    setLearningProgress(prev => {
      const next = { ...prev };
      let changed = false;
      Object.entries(TRACKABLE_ELEMENTS).forEach(([type, sel]) => {
        if (!next[type] && container.querySelector(sel)) { next[type] = true; changed = true; }
      });
      if (!changed) return prev;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      return next;
    });
  }, [markdown, markedReady, hljsReady]);

  // Stats
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length.toLocaleString() : "0";
  const lines = markdown ? markdown.split("\n").length.toLocaleString() : "0";
  const chars = markdown.length.toLocaleString();

  // File loading
  const loadFile = useCallbackMD((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(createDocTimerRef.current);
      setCurrentDocId(null);
      setMarkdown(ev.target.result);
    };
    reader.readAsText(file);
  }, []);

  // Drag-and-drop on the whole window
  useEffectMD(() => {
    const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
    const onDragLeave = (e) => {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) setDragOver(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [loadFile]);

  // Global paste when editor not focused
  useEffectMD(() => {
    const onPaste = (e) => {
      if (document.activeElement === editorRef.current) return;
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        clearTimeout(saveTimerRef.current);
        clearTimeout(createDocTimerRef.current);
        setCurrentDocId(null);
        setMarkdown(text);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Drag-handle resize
  const onMouseDownHandle = useCallbackMD((e) => {
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = editorRef.current ? editorRef.current.getBoundingClientRect().width : 0;
    document.body.style.userSelect = "none";
    document.body.style.cursor     = "col-resize";
  }, []);

  useEffectMD(() => {
    const onMouseMove = (e) => {
      if (!dragging.current || !workspaceRef.current) return;
      const handleW = 6, gap = 4;
      const total   = workspaceRef.current.getBoundingClientRect().width - handleW - gap * 2;
      const newW    = Math.max(180, Math.min(total - 180, startW.current + e.clientX - startX.current));
      setEditorWidth(newW);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor     = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Reset flex widths when switching away from split
  useEffectMD(() => {
    if (view !== "split") setEditorWidth(null);
  }, [view]);

  // Tab key in editor
  const onKeyDown = (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const s   = e.target.selectionStart;
    const end = e.target.selectionEnd;
    const val = markdown.substring(0, s) + "  " + markdown.substring(end);
    setMarkdown(val);
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.selectionStart = s + 2;
        editorRef.current.selectionEnd   = s + 2;
      }
    });
  };

  const copyHtml = () => {
    if (!previewRef.current) return;
    navigator.clipboard.writeText(previewRef.current.innerHTML).then(() => {
      setCopyVisible(true);
      setTimeout(() => setCopyVisible(false), 2000);
    });
  };

  const insertSnippet = useCallbackMD((item) => {
    const el = editorRef.current;
    const pos    = el ? el.selectionStart : markdown.length;
    const selEnd = el ? el.selectionEnd   : markdown.length;
    const selected = el ? markdown.substring(pos, selEnd) : '';

    let newVal, cursorStart, cursorEnd;
    if (selected) {
      newVal      = markdown.substring(0, pos) + item.before + selected + item.after + markdown.substring(selEnd);
      cursorStart = pos + item.before.length;
      cursorEnd   = pos + item.before.length + selected.length;
    } else {
      newVal      = markdown.substring(0, pos) + item.before + item.placeholder + item.after + markdown.substring(selEnd);
      cursorStart = pos + item.before.length;
      cursorEnd   = pos + item.before.length + item.placeholder.length;
    }

    setMarkdown(newVal);
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        editorRef.current.selectionStart = cursorStart;
        editorRef.current.selectionEnd   = cursorEnd;
      }
    });
  }, [markdown]);

  // Document handlers
  function handleOpenDoc(id) {
    clearTimeout(saveTimerRef.current);
    clearTimeout(createDocTimerRef.current);
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    isLoadingDoc.current = true;
    setMarkdown(doc.content);
    setCurrentDocId(id);
    setSaveStatus('');
    setShowModal(false);
  }

  function handleNewDoc() {
    clearTimeout(saveTimerRef.current);
    clearTimeout(createDocTimerRef.current);
    isLoadingDoc.current = true;
    setCurrentDocId(null);
    setMarkdown('');
    setSaveStatus('');
    setShowModal(false);
  }

  function handleDeleteDoc(id) {
    const next = docs.filter(d => d.id !== id);
    try { saveDocs(next); } catch {}
    setDocs(next);
    if (currentDocId === id) {
      isLoadingDoc.current = true;
      setCurrentDocId(null);
      setMarkdown('');
      setSaveStatus('');
    }
  }

  function handleRenameDoc(id, name) {
    const next = docs.map(d => d.id === id ? { ...d, name: name || null } : d);
    try { saveDocs(next); } catch {}
    setDocs(next);
  }

  const currentDoc          = docs.find(d => d.id === currentDocId) || null;
  const hasUnsavedContent   = !currentDocId && markdown.trim().length > 0;

  const saveStatusEl = {
    saving:   <span style={{ color: 'var(--text-subtle)' }}>Saving…</span>,
    saved:    <span style={{ color: 'var(--success)' }}>Saved</span>,
    unsaved:  <span style={{ color: 'var(--text-subtle)' }}>Unsaved changes</span>,
    error:    <span style={{ color: 'var(--danger)' }}>Save failed</span>,
  }[saveStatus] || null;


  const editorPaneStyle = {
    display:       "flex",
    flexDirection: "column",
    background:    "var(--surface)",
    border:        "1px solid var(--border)",
    borderRadius:  "var(--radius)",
    overflow:      "hidden",
    minWidth:      220,
    ...(view === "preview"
      ? { display: "none" }
      : editorWidth !== null
        ? { flex: "none", width: editorWidth }
        : { flex: 1 }),
  };

  const previewPaneStyle = {
    display:       "flex",
    flexDirection: "column",
    background:    "var(--surface)",
    border:        "1px solid var(--border)",
    borderRadius:  "var(--radius)",
    overflow:      "hidden",
    minWidth:      220,
    flex:          1,
    position:      "relative",
    ...(view === "editor" ? { display: "none" } : {}),
  };

  return (
    <>
      <style>{`
        .md-content h1, .md-content h2, .md-content h3, .md-content h4, .md-content h5, .md-content h6 {
          margin: 1.5em 0 .5em; line-height: 1.3; font-weight: 700; color: var(--text);
        }
        .md-content h1:first-child, .md-content h2:first-child { margin-top: 0; }
        .md-content h1 { font-size: 1.85em; border-bottom: 2px solid var(--border); padding-bottom: .35em; }
        .md-content h2 { font-size: 1.35em; border-bottom: 1px solid var(--border); padding-bottom: .25em; }
        .md-content h3 { font-size: 1.15em; }
        .md-content h4 { font-size: 1em; }
        .md-content p { margin: .75em 0; }
        .md-content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
        .md-content a:hover { opacity: .8; }
        .md-content ul, .md-content ol { padding-left: 1.6em; margin: .65em 0; }
        .md-content li { margin: .3em 0; }
        .md-content li > ul, .md-content li > ol { margin: .2em 0; }
        .md-content blockquote {
          border-left: 3px solid var(--accent); margin: 1.1em 0;
          padding: .6em 1em .6em 1.1em; background: var(--accent-soft);
          border-radius: 0 var(--radius) var(--radius) 0; color: var(--text-muted);
        }
        .md-content code:not(pre code) {
          background: var(--surface-2); padding: .18em .45em; border-radius: 4px;
          font-family: var(--mono);
          font-size: .855em; color: var(--danger);
        }
        .md-content pre {
          position: relative; margin: 1.1em 0; border-radius: var(--radius);
          overflow: hidden; border: 1px solid var(--border);
        }
        .md-content pre code {
          display: block; padding: 16px 20px;
          font-family: var(--mono);
          font-size: 12.5px; line-height: 1.65; overflow-x: auto;
        }
        .md-content pre[data-lang]::before {
          content: attr(data-lang); position: absolute; top: 0; right: 0;
          padding: 2px 8px; font-size: 10px; font-family: var(--sans);
          font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
          color: var(--text-subtle); background: rgba(0,0,0,.04);
          border-bottom-left-radius: var(--radius);
        }
        .md-content table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
        .md-content th, .md-content td { border: 1px solid var(--border); padding: 8px 13px; text-align: left; }
        .md-content th { background: var(--surface-2); font-weight: 600; }
        .md-content tr:nth-child(even) td { background: var(--surface-2); }
        .md-content img { max-width: 100%; border-radius: var(--radius); display: block; }
        .md-content hr { border: none; border-top: 2px solid var(--border); margin: 1.8em 0; }
        .md-content .task-list-item { list-style: none; margin-left: -1.2em; }
        .md-content .task-list-item input { margin-right: .45em; accent-color: var(--accent); }
        .md-learn [data-md-source] { outline: 1px dashed var(--accent-border); outline-offset: 1px; border-radius: 2px; cursor: help; }
        .md-learn [data-md-source]:hover { outline-color: var(--accent); background: var(--accent-soft); }
      `}</style>

      <div style={{
        display:       "flex",
        flexDirection: "column",
        height:        "100%",
        overflow:      "hidden",
        background:    "var(--bg)",
        color:         "var(--text)",
        fontFamily:    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
        fontSize:      14,
      }}>

        {/* TOP BAR */}
        <div style={{
          display:    "flex",
          alignItems: "center",
          gap:        10,
          padding:    "0 16px",
          height:     44,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: ".02em", marginRight: 4, whiteSpace: "nowrap" }}>
            Markdown
          </span>

          {/* View tabs */}
          <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", padding: 3, gap: 2 }}>
            {["editor", "split", "preview"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding:       "4px 12px",
                  borderRadius:  3,
                  border:        "none",
                  background:    view === v ? "var(--accent)" : "transparent",
                  color:         view === v ? "var(--accent-fg)" : "var(--text-muted)",
                  fontSize:      12,
                  fontWeight:    500,
                  cursor:        "pointer",
                  whiteSpace:    "nowrap",
                  textTransform: "capitalize",
                }}
              >{v}</button>
            ))}
          </div>

          {/* Current document name (centre) */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minWidth: 0 }}>
            {(currentDoc || hasUnsavedContent) && (
              <button
                onClick={() => setShowModal(true)}
                title="Open documents"
                style={{
                  background:    "transparent",
                  border:        "none",
                  cursor:        "pointer",
                  color:         currentDoc ? "var(--text)" : "var(--text-subtle)",
                  fontSize:      12,
                  maxWidth:      "100%",
                  overflow:      "hidden",
                  textOverflow:  "ellipsis",
                  whiteSpace:    "nowrap",
                  padding:       "4px 8px",
                  borderRadius:  4,
                }}
              >
                {currentDoc ? displayName(currentDoc) : "Untitled · unsaved"}
              </button>
            )}
            {learnMode && (
              <span style={{
                marginLeft: 12, fontSize: 11, color: 'var(--text-subtle)',
                background: 'rgba(34,197,94,.12)', borderRadius: 10,
                padding: '2px 10px', border: '1px solid rgba(34,197,94,.25)',
                whiteSpace: 'nowrap',
              }}>
                {Object.values(learningProgress).filter(Boolean).length} / {Object.keys(TRACKABLE_ELEMENTS).length} elements discovered
              </span>
            )}
          </div>

          {/* Open file */}
          <label style={barBtnStyle}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 13V5l4-4h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>
              <path d="M6 1v4H2"/>
            </svg>
            Open
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) loadFile(file);
                e.target.value = "";
              }}
            />
          </label>

          <BarSep />

          <button style={barBtnStyle} onClick={copyHtml}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="5" width="9" height="10" rx="1"/>
              <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2"/>
            </svg>
            Copy HTML
          </button>

          <button
            style={barBtnStyle}
            onClick={() => {
              clearTimeout(saveTimerRef.current);
              clearTimeout(createDocTimerRef.current);
              isLoadingDoc.current = true;
              setCurrentDocId(null);
              setMarkdown('');
              setSaveStatus('');
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13"/>
            </svg>
            Clear
          </button>

          <BarSep />

          <button style={barBtnStyle} onClick={() => setShowModal(true)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 13V5l4-4h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>
              <path d="M6 1v4H2"/>
              <line x1="8" y1="8" x2="12" y2="8"/>
              <line x1="8" y1="11" x2="12" y2="11"/>
            </svg>
            Documents{docs.length > 0 ? ` (${docs.length})` : ''}
          </button>

          <BarSep />

          <button
            style={{
              ...barBtnStyle,
              background: cheatSheetOpen ? 'var(--accent-soft)' : 'transparent',
              borderColor: cheatSheetOpen ? 'var(--accent-border)' : 'var(--border)',
              color: cheatSheetOpen ? 'var(--accent)' : 'var(--text-muted)',
            }}
            onClick={() => setCheatSheetOpen(o => !o)}
            title="Toggle cheat sheet"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6"/>
              <path d="M6.2 6a1.8 1.8 0 0 1 3.5.6c0 1.2-1.7 1.8-1.7 1.8"/>
              <circle cx="8" cy="12" r=".4" fill="currentColor"/>
            </svg>
            Cheat Sheet
          </button>

          <button
            style={{
              ...barBtnStyle,
              background: learnMode ? 'rgba(34,197,94,.12)' : 'transparent',
              borderColor: learnMode ? 'rgba(34,197,94,.4)' : 'var(--border)',
              color: learnMode ? 'var(--success)' : 'var(--text-muted)',
            }}
            onClick={() => setLearnMode(m => !m)}
            title="Toggle learn mode — hover preview elements to see their markdown source"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h12M2 8h8M2 13h5"/>
              <circle cx="13" cy="11" r="2.5"/>
              <line x1="15" y1="13.5" x2="16" y2="14.5"/>
            </svg>
            Learn
          </button>

        </div>

        <MarkdownToolbar onInsert={insertSnippet} />

        {/* WORKSPACE */}
        <div
          ref={workspaceRef}
          style={{
            display:    "flex",
            flex:       1,
            overflow:   "hidden",
            background: "var(--bg)",
            gap:        4,
            padding:    4,
          }}
        >
          {/* EDITOR PANE */}
          <div style={editorPaneStyle}>
            <PaneHeader label="Markdown" />
            <textarea
              ref={editorRef}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              placeholder={"# Start writing…\n\nPaste markdown here, open a .md file, or drag one onto the window."}
              style={{
                flex:       1,
                resize:     "none",
                border:     "none",
                outline:    "none",
                padding:    "16px 18px",
                fontFamily: "'Cascadia Code', 'Fira Code', Consolas, Menlo, monospace",
                fontSize:   13,
                lineHeight: 1.7,
                color:      "var(--text)",
                background: "var(--surface)",
                tabSize:    2,
                overflowY:  "auto",
                display:    "block",
              }}
            />
          </div>

          {/* DRAG HANDLE */}
          {view === "split" && (
            <div
              onMouseDown={onMouseDownHandle}
              style={{
                width:          6,
                flexShrink:     0,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                cursor:         "col-resize",
                borderRadius:   3,
              }}
            >
              <div style={{ width: 2, height: 40, borderRadius: 2, background: "var(--border-strong)" }} />
            </div>
          )}

          {/* PREVIEW PANE */}
          <div style={previewPaneStyle}>
            <PaneHeader label="Preview" />
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px" }}>
              <div
                className={`md-content${learnMode ? ' md-learn' : ''}`}
                ref={previewRef}
                style={{ maxWidth: 740, margin: "0 auto", lineHeight: 1.8, color: "var(--text)" }}
              />
            </div>
            {cheatSheetOpen && (
              <CheatSheetPanel
                filter={cheatSheetFilter}
                onFilterChange={setCheatSheetFilter}
                learningProgress={learningProgress}
                onInsert={insertSnippet}
                onClose={() => setCheatSheetOpen(false)}
              />
            )}
          </div>
        </div>

        {/* STATUS BAR */}
        <div style={{
          display:    "flex",
          alignItems: "center",
          gap:        16,
          height:     26,
          padding:    "0 14px",
          background: "var(--surface-2)",
          borderTop:  "1px solid var(--border)",
          flexShrink: 0,
          userSelect: "none",
          fontSize:   11,
          color:      "var(--text-subtle)",
        }}>
          <span><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{words}</span> words</span>
          <span><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{lines}</span> lines</span>
          <span><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{chars}</span> chars</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
            {saveStatusEl}
            <span style={{ color: "var(--success)", opacity: copyVisible ? 1 : 0, transition: "opacity .2s" }}>
              Copied to clipboard
            </span>
          </span>
        </div>

        {/* DROP OVERLAY */}
        {dragOver && (
          <div style={{
            position:       "fixed",
            inset:          0,
            zIndex:         200,
            background:     "rgba(59,110,248,.1)",
            backdropFilter: "blur(2px)",
            pointerEvents:  "none",
          }}>
            <div style={{
              position:       "absolute",
              inset:          12,
              border:         "2px dashed var(--accent)",
              borderRadius:   10,
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              justifyContent: "center",
              gap:            10,
              color:          "var(--accent)",
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .7 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <p style={{ fontSize: 15, fontWeight: 600 }}>Drop .md file to open</p>
            </div>
          </div>
        )}

        {/* DOCUMENTS MODAL */}
        {showModal && (
          <DocumentsModal
            docs={docs}
            currentDocId={currentDocId}
            markedReady={markedReady}
            hasUnsavedContent={hasUnsavedContent}
            onOpen={handleOpenDoc}
            onNew={handleNewDoc}
            onDelete={handleDeleteDoc}
            onRename={handleRenameDoc}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    </>
  );
}

const barBtnStyle = {
  display:        "inline-flex",
  alignItems:     "center",
  gap:            6,
  padding:        "5px 12px",
  borderRadius:   "var(--radius-sm)",
  border:         "1px solid var(--border)",
  background:     "transparent",
  color:          "var(--text-muted)",
  fontSize:       12,
  fontWeight:     500,
  cursor:         "pointer",
  whiteSpace:     "nowrap",
  textDecoration: "none",
};

function BarSep() {
  return (
    <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />
  );
}

export { MarkdownViewer };
// displayName is exported inline above (used by web's settings view).

function PaneHeader({ label }) {
  return (
    <div style={{
      height:       32,
      display:      "flex",
      alignItems:   "center",
      padding:      "0 14px",
      background:   "var(--surface-2)",
      borderBottom: "1px solid var(--border)",
      flexShrink:   0,
    }}>
      <span style={{
        fontSize:      11,
        fontWeight:    600,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color:         "var(--text-muted)",
      }}>
        {label}
      </span>
    </div>
  );
}


