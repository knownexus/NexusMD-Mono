import React from 'react';
import { toast } from '../toast.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { Icon } from '../icons.jsx';
// view-lists.jsx — Custom Lists view for manual profiles.
// Manages lists (collections of items with configurable fields) stored at
// getProfileKey('helm.lists') as { lists: [...] }.

const { useState: useLSt, useEffect: useLEff, useMemo: useLMm, useRef: useLRef, useCallback: useLCb } = React;

// ── Storage ──────────────────────────────────────────────────────────────────
function readLists() {
  try {
    const s = localStorage.getItem(getProfileKey('helm.lists'));
    return s ? JSON.parse(s) : { lists: [] };
  } catch (_) { return { lists: [] }; }
}

function writeLists(data) {
  localStorage.setItem(getProfileKey('helm.lists'), JSON.stringify(data));
}

function newId() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// ── Field types ──────────────────────────────────────────────────────────────
const FIELD_DEFS = [
  { id: 'owner',    label: 'Owner',     type: 'text'     },
  { id: 'status',   label: 'Status',    type: 'status'   },
  { id: 'due',      label: 'Due date',  type: 'date'     },
  { id: 'priority', label: 'Priority',  type: 'priority' },
  { id: 'notes',    label: 'Notes',     type: 'text'     },
  { id: 'number',   label: 'Number',    type: 'number'   },
  { id: 'url',      label: 'URL',       type: 'url'      },
  { id: 'check',    label: 'Checkbox',  type: 'boolean'  },
];

const PRIORITY_LABELS = ['P1', 'P2', 'P3', 'P4'];
const DEFAULT_STATUSES = ['Not started', 'In progress', 'Done', 'Blocked'];
const DEFAULT_FIELDS   = ['owner', 'status', 'due', 'priority', 'notes'];

// ── Status bucket mapping (for Board view) ───────────────────────────────────
function toBucket(status) {
  const s = (status || '').toLowerCase();
  if (/done|complet|closed|finish/.test(s)) return 'done';
  if (/block/.test(s)) return 'blocked';
  if (/progress|active|start|doing/.test(s)) return 'inprogress';
  return 'notstarted';
}

const BUCKET_ORDER  = ['notstarted', 'inprogress', 'done', 'blocked'];
const BUCKET_LABELS = { notstarted: 'Not started', inprogress: 'In progress', done: 'Done', blocked: 'Blocked' };

// ── ListEditor modal ──────────────────────────────────────────────────────────
function ListEditor({ list, onSave, onClose }) {
  const isNew = !list;
  const [name, setName]         = useLSt(list?.name || '');
  const [color, setColor]       = useLSt(list?.color || '#6c8ebf');
  const [fields, setFields]     = useLSt(list?.fields || DEFAULT_FIELDS);
  const [statuses, setStatuses] = useLSt((list?.statuses || DEFAULT_STATUSES).join('\n'));

  const COLORS = ['#6c8ebf', '#9a7e22', '#48b870', '#e05a2b', '#8098e0', '#b86078', '#7c7c7c'];

  const toggleField = (fid) => {
    setFields(prev => prev.includes(fid) ? prev.filter(f => f !== fid) : [...prev, fid]);
  };

  const save = () => {
    if (!name.trim()) { toast?.('List name is required.', 'error'); return; }
    const statusList = statuses.split('\n').map(s => s.trim()).filter(Boolean);
    onSave({ name: name.trim(), color, fields, statuses: statusList.length ? statusList : DEFAULT_STATUSES });
  };

  return (
    <PlModal open onClose={onClose} icon="work" title={isNew ? 'New list' : 'Edit list'}
      footer={
        <React.Fragment>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </React.Fragment>
      }>
      <PlFld label="List name">
        <input value={name} autoFocus onChange={e => setName(e.target.value)} />
      </PlFld>
      <PlFld label="Colour">
        <div style={{ display: 'flex', gap: 8 }}>
          {COLORS.map(c => (
            <button key={c} type="button" onClick={() => setColor(c)} style={{
              width: 26, height: 26, borderRadius: '50%', background: c, border: 'none',
              outline: color === c ? '2px solid var(--accent)' : '2px solid transparent',
              outlineOffset: 2, cursor: 'pointer',
            }} />
          ))}
        </div>
      </PlFld>
      <PlFld label="Fields (choose which columns appear)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FIELD_DEFS.map(f => {
            const on = fields.includes(f.id);
            return (
              <button key={f.id} type="button" onClick={() => toggleField(f.id)} style={{
                padding: '4px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                color: on ? 'var(--accent)' : 'var(--text)',
                fontWeight: on ? 600 : 400,
              }}>{f.label}</button>
            );
          })}
        </div>
      </PlFld>
      <PlFld label="Statuses (one per line)">
        <textarea rows={4} value={statuses} onChange={e => setStatuses(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />
      </PlFld>
    </PlModal>
  );
}

// ── ItemEditor modal ──────────────────────────────────────────────────────────
function ItemEditor({ item, list, onSave, onClose }) {
  const isNew = !item;
  const [vals, setVals] = useLSt(() => {
    const init = { title: '', owner: '', status: list.statuses[0] || '', due: '', priority: '', notes: '', number: '', url: '', check: false };
    return item ? { ...init, ...item } : init;
  });

  const set = (k, v) => setVals(prev => ({ ...prev, [k]: v }));

  const save = () => {
    if (!vals.title.trim()) { toast?.('Title is required.', 'error'); return; }
    onSave({ ...vals, title: vals.title.trim() });
  };

  const renderField = (f) => {
    switch (f.type) {
      case 'status':
        return (
          <select value={vals.status} onChange={e => set('status', e.target.value)}>
            {list.statuses.map(s => <option key={s}>{s}</option>)}
          </select>
        );
      case 'priority':
        return (
          <select value={vals.priority} onChange={e => set('priority', e.target.value)}>
            <option value="">—</option>
            {PRIORITY_LABELS.map(p => <option key={p}>{p}</option>)}
          </select>
        );
      case 'date':
        return <input type="date" value={vals.due} onChange={e => set('due', e.target.value)} />;
      case 'number':
        return <input type="number" value={vals.number} onChange={e => set('number', e.target.value)} />;
      case 'url':
        return <input type="url" value={vals.url} placeholder="https://…" onChange={e => set('url', e.target.value)} />;
      case 'boolean':
        return <label><input type="checkbox" checked={!!vals.check} onChange={e => set('check', e.target.checked)} /> Yes</label>;
      default:
        if (f.id === 'notes') {
          return <textarea rows={3} value={vals.notes} onChange={e => set('notes', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }} />;
        }
        if (f.id === 'owner') {
          const team = HelmData?.TEAM || [];
          return (
            <select value={vals.owner} onChange={e => set('owner', e.target.value)}>
              <option value="">— Unassigned —</option>
              {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          );
        }
        return <input value={vals[f.id] ?? ''} onChange={e => set(f.id, e.target.value)} />;
    }
  };

  return (
    <PlModal open onClose={onClose} icon="work" title={isNew ? 'New item' : 'Edit item'}
      footer={
        <React.Fragment>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </React.Fragment>
      }>
      <PlFld label="Title">
        <input value={vals.title} autoFocus onChange={e => set('title', e.target.value)} />
      </PlFld>
      {list.fields.map(fid => {
        const def = FIELD_DEFS.find(f => f.id === fid);
        if (!def) return null;
        return <PlFld key={fid} label={def.label}>{renderField(def)}</PlFld>;
      })}
    </PlModal>
  );
}

// ── SubItemRow ────────────────────────────────────────────────────────────────
function SubItemRow({ sub, onToggle, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'var(--surface-2)' }}>
      <input type="checkbox" checked={!!sub.done} onChange={() => onToggle(sub.id)} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 12, textDecoration: sub.done ? 'line-through' : 'none', opacity: sub.done ? .5 : 1 }}>
        {sub.title}
      </div>
      {sub.owner && <span style={{ fontSize: 11, opacity: .5 }}>{sub.owner}</span>}
      <button className="btn icon ghost sm" onClick={() => onDelete(sub.id)} style={{ opacity: .4 }}>
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

// ── ListDetailView ─────────────────────────────────────────────────────────────
function ListDetailView({ list, onUpdate }) {
  const [expandedIds, setExpanded] = useLSt(new Set());
  const [editingItem, setEditItem] = useLSt(null);
  const [newSubText, setNewSubText] = useLSt({});

  const toggleExpand = (id) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const saveItem = (vals) => {
    const items = list.items || [];
    if (editingItem === 'new') {
      onUpdate({ items: [...items, { id: newId(), ...vals, children: [] }] });
    } else {
      onUpdate({ items: items.map(i => i.id === editingItem.id ? { ...i, ...vals } : i) });
    }
    setEditItem(null);
  };

  const deleteItem = (id) =>
    onUpdate({ items: (list.items || []).filter(i => i.id !== id) });

  const addSubItem = (parentId, title) => {
    if (!title.trim()) return;
    const sub = { id: newId(), title: title.trim(), owner: '', done: false };
    onUpdate({
      items: (list.items || []).map(i =>
        i.id === parentId ? { ...i, children: [...(i.children || []), sub] } : i
      ),
    });
    setNewSubText(prev => ({ ...prev, [parentId]: '' }));
  };

  const toggleSub = (parentId, subId) =>
    onUpdate({
      items: (list.items || []).map(i =>
        i.id !== parentId ? i : {
          ...i,
          children: (i.children || []).map(s => s.id === subId ? { ...s, done: !s.done } : s),
        }
      ),
    });

  const deleteSub = (parentId, subId) =>
    onUpdate({
      items: (list.items || []).map(i =>
        i.id !== parentId ? i : { ...i, children: (i.children || []).filter(s => s.id !== subId) }
      ),
    });

  const fieldDefs = (list.fields || []).map(fid => FIELD_DEFS.find(f => f.id === fid)).filter(Boolean);
  const items = list.items || [];

  const renderCell = (item, def) => {
    const v = item[def.id];
    if (def.type === 'boolean') return v ? '✓' : '—';
    if (def.type === 'url' && v) return <a href={v} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>{v.replace(/^https?:\/\//, '').slice(0, 30)}</a>;
    if (def.id === 'status' && v) {
      const bucket = toBucket(v);
      const bg = bucket === 'done' ? '#e8f5e9' : bucket === 'blocked' ? '#fce4ec' : bucket === 'inprogress' ? '#fff3e0' : 'var(--surface-2)';
      const col = bucket === 'done' ? '#2e7d32' : bucket === 'blocked' ? '#c62828' : bucket === 'inprogress' ? '#e65100' : 'var(--text)';
      return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: bg, color: col }}>{v}</span>;
    }
    return v || '—';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', marginBottom: 4 }}>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setEditItem('new')}>+ Add item</button>
      </div>

      {items.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', opacity: .4, fontSize: 14 }}>
          No items yet — click "+ Add item" to get started.
        </div>
      )}

      {items.map(item => (
        <div key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
            <button className="btn icon ghost sm" style={{ opacity: .4 }} onClick={() => toggleExpand(item.id)}>
              {expandedIds.has(item.id) ? '▼' : '▶'}
            </button>
            <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{item.title}</div>
            {fieldDefs.map(def => (
              <div key={def.id} style={{ fontSize: 12, minWidth: 60, textAlign: 'right' }}>
                {renderCell(item, def)}
              </div>
            ))}
            <button className="btn icon ghost sm" onClick={() => setEditItem(item)} style={{ opacity: .5 }}>
              <Icon name="edit" size={12} />
            </button>
            <button className="btn icon ghost sm danger" onClick={() => deleteItem(item.id)} style={{ opacity: .4 }}>
              <Icon name="x" size={12} />
            </button>
          </div>

          {expandedIds.has(item.id) && (
            <div style={{ marginLeft: 28, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(item.children || []).map(sub => (
                <SubItemRow key={sub.id} sub={sub}
                  onToggle={(sid) => toggleSub(item.id, sid)}
                  onDelete={(sid) => deleteSub(item.id, sid)} />
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <input
                  className="mock-input" placeholder="Add sub-item…"
                  value={newSubText[item.id] || ''}
                  style={{ flex: 1, fontSize: 12 }}
                  onChange={e => setNewSubText(prev => ({ ...prev, [item.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addSubItem(item.id, newSubText[item.id] || ''); }}
                />
                <button className="btn sm" onClick={() => addSubItem(item.id, newSubText[item.id] || '')}>Add</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {editingItem && (
        <ItemEditor
          item={editingItem === 'new' ? null : editingItem}
          list={list}
          onSave={saveItem}
          onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}

// ── BoardView ─────────────────────────────────────────────────────────────────
function BoardView({ lists }) {
  const allItems = lists.flatMap(l =>
    (l.items || []).map(i => ({ ...i, listName: l.name, listColor: l.color }))
  );

  const buckets = BUCKET_ORDER.map(b => ({
    id: b,
    label: BUCKET_LABELS[b],
    items: allItems.filter(i => toBucket(i.status) === b),
  }));

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '12px 0', minHeight: 200 }}>
      {buckets.map(b => (
        <div key={b.id} style={{ minWidth: 180, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', opacity: .5, marginBottom: 2 }}>
            {b.label} <span style={{ fontWeight: 400 }}>({b.items.length})</span>
          </div>
          {b.items.map(item => (
            <div key={item.id} style={{
              padding: '8px 10px', borderRadius: 8, background: 'var(--surface)',
              border: '1px solid var(--border)', fontSize: 12,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>{item.title}</div>
              <div style={{ fontSize: 11, opacity: .5 }}>
                <span style={{ color: item.listColor }}>●</span> {item.listName}
                {item.owner ? ` · ${item.owner}` : ''}
              </div>
            </div>
          ))}
          {b.items.length === 0 && (
            <div style={{ fontSize: 12, opacity: .3, padding: '8px 0', textAlign: 'center' }}>—</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── MyItemsView ───────────────────────────────────────────────────────────────
function MyItemsView({ lists }) {
  const displayName = (() => {
    try { return localStorage.getItem(getProfileKey('helm.profile.displayName')) || ''; } catch (_) { return ''; }
  })();

  const mine = lists.flatMap(l =>
    (l.items || [])
      .filter(i => displayName && (i.owner || '').toLowerCase() === displayName.toLowerCase())
      .map(i => ({ ...i, listName: l.name, listColor: l.color, statuses: l.statuses }))
  );

  if (!displayName) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', opacity: .4 }}>
        Set a display name in Settings → Profile to see your items here.
      </div>
    );
  }

  if (!mine.length) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', opacity: .4 }}>
        No items assigned to you yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {mine.map(item => {
        const bucket = toBucket(item.status);
        const statusBg = bucket === 'done' ? '#e8f5e9' : bucket === 'blocked' ? '#fce4ec' : bucket === 'inprogress' ? '#fff3e0' : 'var(--surface-2)';
        const statusCol = bucket === 'done' ? '#2e7d32' : bucket === 'blocked' ? '#c62828' : bucket === 'inprogress' ? '#e65100' : 'var(--text)';
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div>
              <div style={{ fontSize: 11, opacity: .5 }}><span style={{ color: item.listColor }}>●</span> {item.listName}</div>
            </div>
            {item.status && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: statusBg, color: statusCol }}>{item.status}</span>}
            {item.due && <span style={{ fontSize: 11, opacity: .5 }}>{item.due}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── ListsView (root) ──────────────────────────────────────────────────────────
function ListsView() {
  const [data, setData] = useLSt(readLists);
  const [activeListId, setActiveListId] = useLSt(null);
  const [mainTab, setMainTab] = useLSt('list');
  const [editingList, setEditList] = useLSt(null);

  const save = (next) => { setData(next); writeLists(next); };

  const createList = (opts) => {
    const l = { id: newId(), items: [], ...opts };
    const next = { lists: [...data.lists, l] };
    save(next);
    setActiveListId(l.id);
    setEditList(null);
  };

  const updateList = (id, changes) => {
    save({ lists: data.lists.map(l => l.id === id ? { ...l, ...changes } : l) });
  };

  const deleteList = (id) => {
    if (!window.confirm('Delete this list and all its items?')) return;
    const next = { lists: data.lists.filter(l => l.id !== id) };
    save(next);
    if (activeListId === id) setActiveListId(next.lists[0]?.id || null);
  };

  const activeList = data.lists.find(l => l.id === activeListId) || data.lists[0] || null;

  // Build the unified tab list: each list gets a tab, then Board and My items
  const listTabs = data.lists.map(l => ({ id: l.id, label: l.name, color: l.color, kind: 'list' }));
  const fixedTabs = [
    { id: '__board', label: 'Board', color: null, kind: 'board' },
    { id: '__mine',  label: 'My items', color: null, kind: 'mine'  },
  ];
  const allTabs = [...listTabs, ...fixedTabs];

  // activeTab is either a list id, '__board', or '__mine'
  const activeTab = (() => {
    if (mainTab === 'board') return '__board';
    if (mainTab === 'mine')  return '__mine';
    return activeListId || data.lists[0]?.id || '__board';
  })();

  const selectTab = (tab) => {
    if (tab.kind === 'board') { setMainTab('board'); return; }
    if (tab.kind === 'mine')  { setMainTab('mine');  return; }
    setActiveListId(tab.id);
    setMainTab('list');
  };

  // Edit button for the currently active list (shown in appbar)
  const editingActiveList = mainTab === 'list' && activeList;

  return (
    <React.Fragment>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <h1>Lists</h1>
        </div>
        <div className="m-ab-actions">
          {editingActiveList && (
            <button className="btn sm ghost" onClick={() => setEditList(activeList)}>
              <Icon name="edit" size={13}/> Edit list
            </button>
          )}
          <button className="btn sm" onClick={() => setEditList('new')}>+ New list</button>
        </div>
      </div>
      <div className="m-screen" data-screen-label="Lists">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>

          {/* Unified tab bar */}
          <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {allTabs.map(tab => {
              const active = tab.id === activeTab;
              return (
                <button key={tab.id} onClick={() => selectTab(tab)} style={{
                  padding: '8px 16px', fontSize: 13, border: 'none', background: 'none', whiteSpace: 'nowrap',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  color: active ? 'var(--accent)' : 'var(--text)',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer', flexShrink: 0,
                }}>
                  {tab.color && <span style={{ color: tab.color, marginRight: 5 }}>●</span>}
                  {tab.label}
                </button>
              );
            })}
            {data.lists.length === 0 && (
              <span style={{ padding: '8px 16px', fontSize: 13, opacity: .4 }}>No lists yet — create one to get started</span>
            )}
          </div>

          {/* Content */}
          <div style={{ flex: 1, padding: '16px 20px', minWidth: 0, overflowY: 'auto' }}>
            {mainTab === 'list' && activeList && (
              <ListDetailView
                list={activeList}
                onUpdate={(changes) => updateList(activeList.id, changes)} />
            )}
            {mainTab === 'list' && !activeList && (
              <div style={{ padding: '60px 0', textAlign: 'center', opacity: .4 }}>
                Create a list to get started.
              </div>
            )}
            {mainTab === 'board' && <BoardView lists={data.lists} />}
            {mainTab === 'mine'  && <MyItemsView lists={data.lists} />}
          </div>
        </div>
      </div>

      {/* List editor modal */}
      {editingList && (
        <ListEditor
          list={editingList === 'new' ? null : editingList}
          onSave={(opts) => {
            if (editingList === 'new') {
              createList(opts);
            } else {
              updateList(editingList.id, opts);
              setEditList(null);
            }
          }}
          onClose={() => setEditList(null)} />
      )}
    </React.Fragment>
  );
}

export { ListsView };
