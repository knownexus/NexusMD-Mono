// json-tree-ui.jsx — edit one node of a JSON tree: its name, type and value, or delete it; for a group
// or list, add a field or item. Shared by the desktop JSON editor and the phone layout. The sheet only
// builds the next tree (with @nexusmd/core's editNode/addChild, which refuse a duplicate name or a bad
// number): the caller saves it and offers Undo. Keys and values are shown as React text, never HTML.
import React from 'react';
import { createPortal } from 'react-dom';
import { getAtPath, typeOf, TYPE_OPTIONS, isContainer, rawOf, describePath, editNode, addChild, removeNode } from '@nexusmd/core';
import { Icon } from './icons.jsx';
import { Sheet } from './app-components.jsx';

const pathId = (p) => p.join('\u0001');

/**
 * @param {object}   props
 * @param {*}        props.data        the whole parsed document
 * @param {Array|null} props.path      the node being edited; null keeps the sheet closed
 * @param {boolean}  [props.startAdding] open straight on "add a field/item" (for a group or list)
 * @param {boolean}  [props.overlay]   render in a full-window overlay (desktop) instead of in place (phone)
 * @param {Function} props.onClose
 * @param {Function} props.onApply     (nextData, message) once a change is accepted
 */
export function JsonNodeSheet({ data, path, startAdding = false, overlay = false, onClose, onApply }) {
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
    setError(''); setConfirmDelete(false); setAdding(!!startAdding && isContainer(node)); setChild({ key: '', type: 'string', raw: '' });
  }, [open, path && pathId(path), startAdding]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return overlay ? null : <Sheet open={false} onClose={onClose}/>;
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
  // Enter submits from a one-line field; in a text value Enter is a new line and Ctrl/Cmd+Enter submits.
  const submit = () => (adding ? add() : save());
  const onEnter = (e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  const onCtrlEnter = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };

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
      ? <textarea id={id} style={{ minHeight: 80 }} value={value} onKeyDown={onCtrlEnter} onChange={e => { set(e.target.value); setError(''); }} aria-label="Value"/>
      : <input id={id} inputMode="decimal" value={value} onKeyDown={onEnter} onChange={e => { set(e.target.value); setError(''); }} aria-label="Value"/>;
  };

  const sheet = (
    <Sheet open size="tall" icon="edit" sub={describePath(path)} onClose={onClose}
      title={adding ? (Array.isArray(node) ? 'Add an item' : 'Add a field') : path.length ? 'Edit field' : 'Whole document'}
      footer={(
        <>
          {path.length > 0 && !adding && (confirmDelete
            ? <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={remove}>Delete for sure</button>
            : <button type="button" className="btn ghost m-btn-lg" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)} aria-label="Delete"><Icon name="trash" size={15}/> Delete</button>)}
          <button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={submit}>{adding ? (Array.isArray(node) ? 'Add item' : 'Add field') : 'Save'}</button>
        </>
      )}>
      {!adding && (
        <>
          {path.length > 0 && !inList && (
            <div className="m-fld">
              <label htmlFor="jn-key">Name</label>
              <input id="jn-key" value={key} onKeyDown={onEnter} onChange={e => { setKey(e.target.value); setError(''); }} spellCheck={false} autoCapitalize="off"/>
            </div>
          )}
          <div className="m-fld">
            <label htmlFor="jn-type">Type</label>
            <select id="jn-type" value={type} onChange={e => { setType(e.target.value); setError(''); }}>
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
          <div className="m-hint" style={{ marginTop: 0, marginBottom: 10 }}>{Array.isArray(node) ? 'Adds an item to the end of the list.' : 'Adds a field to this group.'}</div>
          {!Array.isArray(node) && (
            <div className="m-fld">
              <label htmlFor="jn-ckey">Name</label>
              <input id="jn-ckey" autoFocus value={child.key} onKeyDown={onEnter} onChange={e => { setChild({ ...child, key: e.target.value }); setError(''); }} spellCheck={false} autoCapitalize="off"/>
            </div>
          )}
          <div className="m-fld">
            <label htmlFor="jn-ctype">Type</label>
            <select id="jn-ctype" value={child.type} onChange={e => setChild({ ...child, type: e.target.value, raw: e.target.value === 'boolean' ? 'true' : '' })}>
              {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="m-fld"><label htmlFor="jn-cval">Value</label>{valueField(child.type, child.raw, (r) => { setChild({ ...child, raw: r }); setError(''); }, 'jn-cval')}</div>
          {!startAdding && <button type="button" className="btn ghost m-btn-lg" onClick={() => { setAdding(false); setError(''); }}>Back</button>}
        </>
      )}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Sheet>
  );
  return overlay ? createPortal(<div className="m-sheet-overlay">{sheet}</div>, document.body) : sheet;
}
