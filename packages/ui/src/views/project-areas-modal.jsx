import React from 'react'
import { Icon } from '../icons.jsx'

const { useState, useEffect } = React

// ── ProjectAreasModal ─────────────────────────────────────────────────────────
// Shared by web and app. Edits the org's area-path tree: { id, name, items[], children[] }.
// Tree helpers — operate on { id, name, items[], children[] } nodes
function _paMapCat(cats, id, fn) {
  return cats.map(c => {
    if (c.id === id) return fn(c);
    const ch = c.children || [];
    if (ch.length) return { ...c, children: _paMapCat(ch, id, fn) };
    return c;
  });
}
function _paRemoveCat(cats, id) {
  return cats
    .filter(c => c.id !== id)
    .map(c => { const ch = c.children || []; return ch.length ? { ...c, children: _paRemoveCat(ch, id) } : c; });
}
function _paFindCat(cats, id) {
  for (const c of cats) {
    if (c.id === id) return c;
    const found = _paFindCat(c.children || [], id);
    if (found) return found;
  }
  return null;
}
function _paGetPath(cats, id, acc = []) {
  for (const c of cats) {
    if (c.id === id) return [...acc, c.name];
    const found = _paGetPath(c.children || [], id, [...acc, c.name]);
    if (found) return found;
  }
  return null;
}
function _paCountAll(cats) {
  return cats.reduce((n, c) => n + (c.items || []).length + _paCountAll(c.children || []), 0);
}

function PACategoryTree({ cats, level = 0, selectedId, onSelect, expandedIds, toggleExpand }) {
  return cats.map(cat => {
    const children = cat.children || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(cat.id);
    const isSelected = selectedId === cat.id;
    const indent = 10 + level * 14;
    return (
      <React.Fragment key={cat.id}>
        <div
          onClick={() => onSelect(cat.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            paddingLeft: indent, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
            cursor: 'pointer', fontSize: level === 0 ? 13 : 12.5, fontWeight: level === 0 ? 600 : 500,
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--accent)' : level === 0 ? 'var(--text)' : 'var(--text-muted)',
            borderRight: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background .1s, color .1s',
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
        >
          <span
            style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}
            onClick={e => { if (hasChildren) { e.stopPropagation(); toggleExpand(cat.id); } }}
          >
            {hasChildren
              ? <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={11}/>
              : <span style={{ width: 11 }}/>}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
          {(cat.items || []).length > 0 && (
            <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-subtle)', flexShrink: 0 }}>
              {(cat.items || []).length}
            </span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <PACategoryTree
            cats={children} level={level + 1}
            selectedId={selectedId} onSelect={onSelect}
            expandedIds={expandedIds} toggleExpand={toggleExpand}
          />
        )}
      </React.Fragment>
    );
  });
}

export function ProjectAreasModal({ open, onClose, areas, setAreas }) {
  const [selectedId, setSelectedId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Auto-select + auto-expand root nodes on open
  useEffect(() => {
    if (open && areas.length > 0) {
      setSelectedId(s => s || areas[0].id);
      setExpandedIds(prev => {
        if (prev.size > 0) return prev;
        const s = new Set();
        areas.forEach(c => s.add(c.id));
        return s;
      });
    }
  }, [open]);

  if (!open) return null;

  const selected = _paFindCat(areas, selectedId) || areas[0] || null;
  const selectedPath = selected ? (_paGetPath(areas, selected.id) || []) : [];

  const toggleExpand = id => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const updateCategoryName = (id, name) => setAreas(prev => _paMapCat(prev, id, c => ({ ...c, name })));

  const deleteCategory = (id) => {
    setAreas(prev => {
      const next = _paRemoveCat(prev, id);
      if (selectedId === id) setSelectedId(next[0]?.id || null);
      return next;
    });
  };

  const addRootCategory = () => {
    const id = 'cat-' + Date.now();
    setAreas(prev => [...prev, { id, name: 'New category', items: [], children: [] }]);
    setSelectedId(id);
  };

  const addChildCategory = (parentId) => {
    const id = 'cat-' + Date.now();
    setAreas(prev => _paMapCat(prev, parentId, c => ({
      ...c, children: [...(c.children || []), { id, name: 'New sub-category', items: [], children: [] }],
    })));
    setExpandedIds(prev => { const s = new Set(prev); s.add(parentId); return s; });
    setSelectedId(id);
  };

  const updateItem = (catId, idx, value) =>
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: (c.items || []).map((it, i) => i === idx ? value : it) })));

  const deleteItem = (catId, idx) =>
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: (c.items || []).filter((_, i) => i !== idx) })));

  const addItem = (catId) => {
    setAreas(prev => _paMapCat(prev, catId, c => ({ ...c, items: [...(c.items || []), ''] })));
    setTimeout(() => {
      const inputs = document.querySelectorAll('.proj-area-item-input');
      inputs[inputs.length - 1]?.focus();
    }, 30);
  };

  const totalItems = _paCountAll(areas);

  return (
    <div id="modal-project-areas" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 800, maxWidth: '100%',
        height: 'min(88vh, 700px)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>Project Areas</h2>
          <button className="btn sm ghost" onClick={addRootCategory}><Icon name="plus" size={12}/> Add category</button>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* Two-panel body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* Left: category tree */}
          <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '8px 0' }}>
            <PACategoryTree
              cats={areas} level={0}
              selectedId={selectedId} onSelect={setSelectedId}
              expandedIds={expandedIds} toggleExpand={toggleExpand}
            />
          </div>

          {/* Right: items for selected node */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {selected ? (
              <>
                {/* Breadcrumb + name editor */}
                <div style={{ padding: '12px 20px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  {selectedPath.length > 1 && (
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
                      {selectedPath.slice(0, -1).join(' / ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      value={selected.name}
                      onChange={e => updateCategoryName(selected.id, e.target.value)}
                      style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--sans)' }}
                      placeholder="Category name"
                    />
                    <button className="btn sm ghost" onClick={() => addChildCategory(selected.id)} title="Add a nested sub-category inside this one">
                      <Icon name="plus" size={12}/> Sub-category
                    </button>
                    <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteCategory(selected.id)} title="Delete">
                      <Icon name="trash" size={13}/>
                    </button>
                  </div>
                </div>

                {/* Items list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
                  {(selected.children || []).length > 0 && (selected.items || []).length === 0 && (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 12.5, padding: '8px 0 12px', fontStyle: 'italic' }}>
                      This category has {selected.children.length} sub-categor{selected.children.length === 1 ? 'y' : 'ies'}. Add items here or use the sub-categories.
                    </div>
                  )}
                  {(selected.items || []).length === 0 && (selected.children || []).length === 0 && (
                    <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: '12px 0' }}>No areas yet — add one below.</div>
                  )}
                  {(selected.items || []).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0 }}/>
                      <input
                        className="proj-area-item-input"
                        value={item}
                        onChange={e => updateItem(selected.id, idx, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); addItem(selected.id); }
                          if (e.key === 'Backspace' && !item) { e.preventDefault(); deleteItem(selected.id, idx); }
                        }}
                        style={{ flex: 1, border: '1px solid transparent', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--text)', fontFamily: 'var(--sans)', padding: '4px 6px', borderRadius: 5 }}
                        onFocus={e => e.target.style.borderColor = 'var(--border)'}
                        onBlur={e => e.target.style.borderColor = 'transparent'}
                      />
                      <button className="btn icon ghost sm" style={{ opacity: 0, color: 'var(--danger)', flexShrink: 0 }}
                        onClick={() => deleteItem(selected.id, idx)}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                        title="Remove"><Icon name="x" size={12}/></button>
                    </div>
                  ))}
                </div>

                {/* Add item */}
                <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
                  <button className="btn sm ghost" onClick={() => addItem(selected.id)}>
                    <Icon name="plus" size={12}/> Add area
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
                Select a category or add one.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {areas.length} root categories · {totalItems} areas total · Enter to add, Backspace on empty to remove
          </span>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
