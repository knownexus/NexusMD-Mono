import React from 'react';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { plRowNotes, loadGlobalNotes, saveGlobalNotes, RowNotesModal } from './planner-notes.jsx';

// Aggregate every table row (in a hasNotes section) that has at least one note,
// for the Planner overview "Planner notes" list. Pure — unit-tested independently.
export function collectRowNotes(data, sections, rowVisible) {
  const out = [];
  sections.forEach(sec => {
    if (sec.type !== 'table' || !sec.hasNotes) return;
    const mainCol = (sec.cols || []).find(c => c.main) || (sec.cols || [])[0];
    (data[sec.id] || []).forEach(row => {
      if (rowVisible && !rowVisible(sec, row)) return;
      const notes = plRowNotes(row);
      if (!notes.length) return;
      out.push({
        sectionId: sec.id,
        sectionTitle: sec.title,
        rowId: row.id,
        rowLabel: (mainCol && row[mainCol.k]) ? String(row[mainCol.k]) : '(untitled)',
        notes,
      });
    });
  });
  return out;
}

function deriveTitle(note) {
  if (note.title && note.title.trim()) return note.title.trim();
  const snippet = (note.body || '').replace(/[#>*`\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return snippet || 'Untitled note';
}

let _promoteSeq = 0;
// Copy (not move) a single planner row note into the week-agnostic library.
export function promoteRowNoteToLibrary(note) {
  const now = new Date().toISOString();
  const entry = {
    id: 'gn' + Date.now() + '-' + (_promoteSeq++),
    title: deriveTitle(note),
    body: note.body || '',
    createdAt: now,
    updatedAt: now,
    status: 'open',
    completedWeek: null,
  };
  const next = [entry, ...loadGlobalNotes()];
  saveGlobalNotes(next);
  return entry;
}

export function PlannerNotesPanel({ data, setData, sections, rowVisible }) {
  const [editing, setEditing] = React.useState(null); // { sectionId, rowId }
  const entries = collectRowNotes(data, sections, rowVisible);

  const updateRowNotes = (sectionId, rowId, notesArr) => {
    setData(prev => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).map(r =>
        r.id === rowId ? { ...r, _notesList: notesArr, _notes: '' } : r),
    }));
  };

  const promoteAll = (entry) => {
    entry.notes.forEach(promoteRowNoteToLibrary);
    toast?.(`Promoted ${entry.notes.length} note${entry.notes.length !== 1 ? 's' : ''} to Notes.`, 'success');
  };

  const editingEntry = editing
    ? entries.find(e => e.sectionId === editing.sectionId && e.rowId === editing.rowId)
    : null;

  return (
    <div className="card pl-section" data-testid="planner-notes-panel">
      <div className="card-head">
        <h3>
          <span className="ic"><Icon name="edit" size={14}/></span>
          Planner notes
          <span className="pl-sec-count">{entries.length} this week</span>
        </h3>
      </div>
      <div className="card-body flush">
        {entries.length === 0 && (
          <div className="empty" style={{ padding: '24px 20px', fontSize: 12.5 }}>
            No notes on this week's planner rows yet. Add notes to a row, then promote the useful ones to your week-agnostic Notes.
          </div>
        )}
        {entries.map(entry => (
          <div key={entry.sectionId + ':' + entry.rowId} className="gnote-card"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="body" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              onClick={() => setEditing({ sectionId: entry.sectionId, rowId: entry.rowId })}>
              <div className="ttl">{entry.rowLabel}</div>
              <div className="meta">
                <span>{entry.sectionTitle}</span>
                <span className="pill">{entry.notes.length} note{entry.notes.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button className="btn sm ghost" title="Copy these notes into your week-agnostic Notes"
              onClick={() => promoteAll(entry)}>
              <Icon name="pin" size={12}/> Promote
            </button>
          </div>
        ))}
      </div>

      {editingEntry && (
        <RowNotesModal
          open={!!editingEntry}
          onClose={() => setEditing(null)}
          title={editingEntry.rowLabel}
          sub={editingEntry.sectionTitle}
          notes={editingEntry.notes}
          onChange={arr => updateRowNotes(editingEntry.sectionId, editingEntry.rowId, arr)}
        />
      )}
    </div>
  );
}
