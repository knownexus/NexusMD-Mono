// docs-frame.jsx — the shared frame of the phone Documents page. One tool at a time (Markdown, JSON, Regex),
// each a single focused pane instead of the desktop's side-by-side panes, with the saved documents
// in a sheet. The tools reuse the shared logic and storage keys, so documents made on the desktop
// layout are still here. The desktop layout (@nexusmd/ui's DocumentsView) is unchanged.
import React from 'react';
import { relativeTime } from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { Sheet } from '../components.jsx';

export const TOOLS = [['markdown', 'Markdown'], ['json', 'JSON'], ['regex', 'Regex']];

// The page: app bar (title, the tool's own actions, saved documents, new), the tool switcher, then
// the tool's body. Every tool renders through this so they all look the same.
export function ToolFrame({ sub, tool, setTool, actions, onDocs, onNew, children, footer }) {
  return (
    <div className="m-docs">
      <div className="m-appbar">
        <div className="m-ab-lead"><div><h1>Documents</h1><div className="m-ab-sub">{sub}</div></div></div>
        <div className="m-ab-actions">
          {actions}
          <button type="button" className="m-iconbtn" aria-label="Saved documents" onClick={onDocs}><Icon name="doc" size={18}/></button>
          <button type="button" className="m-iconbtn" aria-label="New document" onClick={onNew}><Icon name="plus" size={20}/></button>
        </div>
      </div>
      <div className="m-docs-tools">
        <div className="m-seg" role="tablist" aria-label="Tool">
          {TOOLS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={id === tool} className={id === tool ? 'active' : ''} onClick={() => setTool(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="m-docs-body">{children}</div>
      {footer}
    </div>
  );
}

// Saved documents of the active tool: tap to open, pencil to rename, bin to delete (asks first).
export function DocsSheet({ open, onClose, docs, currentDocId, onOpen, onNew, onRename, onDelete, name }) {
  const [renaming, setRenaming] = React.useState(null);
  const [draft, setDraft] = React.useState('');
  const [confirming, setConfirming] = React.useState(null);
  React.useEffect(() => { if (!open) { setRenaming(null); setConfirming(null); } }, [open]);
  const sorted = [...(docs || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const label = (d) => d.name ?? d.autoName ?? 'Untitled';

  return (
    <Sheet open={open} size="tall" icon="doc" title="Saved documents" sub={`${sorted.length} ${name}`} onClose={onClose}
      footer={<button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={() => { onNew(); onClose(); }}>
        <Icon name="plus" size={14}/> New document</button>}>
      {sorted.length === 0 && <div className="m-empty"><div className="et">Nothing saved yet</div><div className="es">Documents save as you type.</div></div>}
      <div className="m-card flush">
        {sorted.map(d => (
          <div key={d.id} className={`m-row${d.id === currentDocId ? ' on' : ''}`}>
            {renaming === d.id ? (
              <input className="m-doc-rename" autoFocus value={draft} aria-label="Document name"
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { onRename(d.id, draft.trim()); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                onBlur={() => { onRename(d.id, draft.trim()); setRenaming(null); }}/>
            ) : (
              <div className="m-row-main" onClick={() => { onOpen(d.id); onClose(); }}>
                <div className="m-row-title">{label(d)}</div>
                <div className="m-row-sub">{relativeTime(d.updatedAt || Date.now())}{d.id === currentDocId ? ' · open' : ''}</div>
              </div>
            )}
            {confirming === d.id ? (
              <>
                <button type="button" className="btn m-btn-lg" onClick={() => setConfirming(null)}>Keep</button>
                <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={() => { onDelete(d.id); setConfirming(null); }}>Delete</button>
              </>
            ) : renaming !== d.id && (
              <>
                <button type="button" className="m-iconbtn" aria-label={`Rename ${label(d)}`} onClick={() => { setRenaming(d.id); setDraft(label(d)); }}><Icon name="edit" size={16}/></button>
                <button type="button" className="m-iconbtn" aria-label={`Delete ${label(d)}`} onClick={() => setConfirming(d.id)}><Icon name="trash" size={16}/></button>
              </>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
