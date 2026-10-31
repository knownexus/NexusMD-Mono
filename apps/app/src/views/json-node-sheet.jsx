// json-node-sheet.jsx — edit one node of the JSON tree on a phone: its name, type and value, or delete
// it; for a group or list, add a field or item. The sheet only builds the next tree: the caller saves
// it and offers Undo.
import React from 'react';
import { getAtPath, typeOf } from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { Sheet } from '../components.jsx';
import { TYPE_OPTIONS, isContainer, rawOf, describePath, editNode, addChild, removeNode } from '../json-tree.js';

export function JsonNodeSheet({ data, path, onClose, onApply }) {
  const open = !!path;
  const node = open ? getAtPath(data, path) : undefined;
  const parent = open && path.length ? getAtPath(data, path.slice(0, -1)) : null;
  const inList = Array.isArray(parent);
  const [key, setKey] = React.useState('');
  const [type, setType] = React.useState('string');
  const [raw, setRaw] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [child, setChild] = React.useState({ key: '', type: 'string', raw: '' });

  React.useEffect(() => {
    if (!open) return;
    setKey(path.length ? String(path[path.length - 1]) : ''); setType(typeOf(node)); setRaw(rawOf(node));
    setError(''); setConfirmDelete(false); setAdding(false); setChild({ key: '', type: 'string', raw: '' });
  }, [open, path && pathId(path)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return <Sheet open={false} onClose={onClose}/>;
  const container = isContainer(node);

  const save = () => {
    const r = editNode(data, path, { key, type, raw });
    if (r.error) { setError(r.error); return; }
    onApply(r.next, `Updated ${describePath(path)}`); onClose();
  };
  const add = () => {
    const r = addChild(data, path, child);
    if (r.error) { setError(r.error); return; }
    onApply(r.next, Array.isArray(node) ? 'Item added' : `Added ${child.key.trim()}`); onClose();
  };
  const remove = () => { onApply(removeNode(data, path), `Deleted ${describePath(path)}`); onClose(); };

  const valueField = (t, value, set, id) => {
    if (t === 'boolean') {
      return (
        <div className="m-seg" role="group" aria-label="Value">
          <button type="button" className={value === 'true' || value === true ? 'active' : ''} onClick={() => set('true')}>True</button>
          <button type="button" className={!(value === 'true' || value === true) ? 'active' : ''} onClick={() => set('false')}>False</button>
        </div>
      );
    }
    if (t === 'null') return <div className="m-hint" style={{ marginTop: 0 }}>The value is empty (null).</div>;
    if (t === 'object' || t === 'array') return <div className="m-hint" style={{ marginTop: 0 }}>{t === 'object' ? 'A group of named fields.' : 'An ordered list.'}</div>;
    return t === 'string'
      ? <textarea id={id} className="m-docs-text short" style={{ fontFamily: 'var(--mono)', minHeight: 80 }} value={value} onChange={e => { set(e.target.value); setError(''); }} aria-label="Value"/>
      : <input id={id} inputMode="decimal" value={value} onChange={e => { set(e.target.value); setError(''); }} aria-label="Value"/>;
  };

  return (
    <Sheet open size="tall" icon="edit" title={path.length ? 'Edit field' : 'Whole document'} sub={describePath(path)} onClose={onClose}
      footer={(
        <>
          {path.length > 0 && (confirmDelete
            ? <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={remove}>Delete for sure</button>
            : <button type="button" className="btn ghost m-btn-lg" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)} aria-label="Delete"><Icon name="trash" size={15}/> Delete</button>)}
          <button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={adding ? add : save}>{adding ? (Array.isArray(node) ? 'Add item' : 'Add field') : 'Save'}</button>
        </>
      )}>
      {!adding && (
        <>
          {path.length > 0 && !inList && (
            <div className="m-fld">
              <label htmlFor="jn-key">Name</label>
              <input id="jn-key" value={key} onChange={e => { setKey(e.target.value); setError(''); }} spellCheck={false} autoCapitalize="off"/>
            </div>
          )}
          <div className="m-fld">
            <label htmlFor="jn-type">Type</label>
            <select id="jn-type" className="m-select" value={type} onChange={e => { setType(e.target.value); setError(''); }}>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {container && type !== typeOf(node) && <div className="m-hint">Changing the type removes what is inside.</div>}
          </div>
          <div className="m-fld"><label htmlFor="jn-val">Value</label>{valueField(type, raw, setRaw, 'jn-val')}</div>
        </>
      )}
      {container && !adding && (
        <button type="button" className="btn m-btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setAdding(true); setError(''); }}>
          <Icon name="plus" size={14}/> {Array.isArray(node) ? 'Add an item' : 'Add a field'}
        </button>
      )}
      {adding && (
        <>
          <div className="m-hint" style={{ marginTop: 0 }}>{Array.isArray(node) ? 'Adds an item to the end of the list.' : 'Adds a field to this group.'}</div>
          {!Array.isArray(node) && (
            <div className="m-fld">
              <label htmlFor="jn-ckey">Name</label>
              <input id="jn-ckey" autoFocus value={child.key} onChange={e => { setChild({ ...child, key: e.target.value }); setError(''); }} spellCheck={false} autoCapitalize="off"/>
            </div>
          )}
          <div className="m-fld">
            <label htmlFor="jn-ctype">Type</label>
            <select id="jn-ctype" className="m-select" value={child.type} onChange={e => setChild({ ...child, type: e.target.value, raw: e.target.value === 'boolean' ? 'true' : '' })}>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="m-fld"><label htmlFor="jn-cval">Value</label>{valueField(child.type, child.raw, (r) => setChild({ ...child, raw: r }), 'jn-cval')}</div>
          <button type="button" className="btn ghost m-btn-lg" onClick={() => { setAdding(false); setError(''); }}>Back</button>
        </>
      )}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Sheet>
  );
}

const pathId = (p) => p.join('\u0001');
