// target-picker.jsx — choosing what a File-or-folder shortcut opens, inside the Add widget sheet. The screen knows nothing of
// repositories, documents or the Editor: the host passes `sources`, each one a kind of thing to pick from.
//
//   { id, label, desc, icon,
//     roots(): Promise<[{ id, title, sub? }]>          what is chosen from first: repositories, documents, a workspace
//     list?(root, path): Promise<[{ name, path, isFolder }]>
//                                                      present when a root is browsed, folder by folder; absent when
//                                                      choosing a root is the pick (a document)
//     toTarget(root, entry): the shortcut target (core shortcuts) for the root's top folder or for an entry in it; it may
//                            return a promise (a file dialog), and nothing at all when the person cancelled }
//
// onPick(target) is called with the finished target; the sheet then asks for a name and adds it.
import React from 'react';
import { Icon } from './icons.jsx';

const { useState, useEffect } = React;
const errorText = (e) => (e && e.message) || 'Could not load that.';
const parentOf = (p) => { const parts = String(p).split('/').filter(Boolean); parts.pop(); return parts.length ? '/' + parts.join('/') : '/'; };
// The picked target, now or when the host has it (a file dialog); nothing when the person cancelled it. A dialog that
// failed is said, not left as an unhandled rejection.
const finish = (target, onPick, onFail) => {
  if (target && typeof target.then === 'function') target.then(t => { if (t) onPick(t); }, e => onFail(errorText(e)));
  else if (target) onPick(target);
};
const baseOf = (p) => String(p).split('/').filter(Boolean).pop() || '';

// One listing, loaded when `load` changes; { items: null } while loading, { error } when it failed.
function useListing(load, key) {
  const [state, setState] = useState({ items: null, error: '' });
  useEffect(() => {
    let live = true;
    setState({ items: null, error: '' });
    Promise.resolve().then(load).then(
      items => { if (live) setState({ items: Array.isArray(items) ? items : [], error: '' }); },
      e => { if (live) setState({ items: [], error: errorText(e) }); },
    );
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Row({ icon, title, sub, onClick, chevron }) {
  return (
    <div className="m-row" role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      {icon ? <span className="m-fileic"><Icon name={icon} size={16}/></span> : null}
      <div className="m-row-main">
        <div className="m-row-title">{title}</div>
        {sub ? <div className="m-row-sub">{sub}</div> : null}
      </div>
      {chevron ? <Icon name="chevron-right" size={16} className="chev"/> : null}
    </div>
  );
}

const Note = ({ children, bad }) => <div className={bad ? 'm-error' : 'm-row-sub'} style={{ padding: 16 }}>{children}</div>;

function Roots({ source, onRoot, onPick, onFail, failure }) {
  const { items, error } = useListing(() => source.roots(), source.id);
  if (items === null) return <Note>Loading…</Note>;
  return (
    <>
      {(error || failure) && <Note bad>{error || failure}</Note>}
      {!error && items.length === 0 && <Note>{source.empty || 'Nothing here yet.'}</Note>}
      {items.map(r => (
        <Row key={r.id} icon={source.list ? 'folder' : 'doc'} title={r.title} sub={r.sub} chevron={!!source.list}
          onClick={() => (source.list ? onRoot(r) : finish(source.toTarget(r, null), onPick, onFail))}/>
      ))}
    </>
  );
}

function Browser({ source, root, path, onPath, onPick, onFail, failure }) {
  const { items, error } = useListing(() => source.list(root, path), `${source.id}|${root.id}|${path}`);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px 8px' }}>
        <div className="m-row-sub" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {root.title}{path === '/' ? '' : path}
        </div>
        <button type="button" className="btn sm primary"
          onClick={() => finish(source.toTarget(root, { name: baseOf(path), path, isFolder: true }), onPick, onFail)}>
          Choose this folder
        </button>
      </div>
      {items === null && <Note>Loading…</Note>}
      {(error || failure) && <Note bad>{error || failure}</Note>}
      {items && !error && items.length === 0 && <Note>This folder is empty.</Note>}
      {(items || []).map(e => (
        <Row key={e.path} icon={e.isFolder ? 'folder' : 'doc'} title={e.name} chevron={e.isFolder}
          onClick={() => (e.isFolder ? onPath(e.path) : finish(source.toTarget(root, e), onPick, onFail))}/>
      ))}
    </>
  );
}

export function TargetPicker({ sources = [], onPick }) {
  const [sourceId, setSourceId] = useState(sources.length === 1 ? sources[0].id : null);
  const [root, setRoot] = useState(null);
  const [path, setPath] = useState('/');
  const [failure, setFailure] = useState('');
  const source = sources.find(s => s.id === sourceId) || null;

  // One step back: up a folder, else out of the repository, else to the list of kinds.
  const back = () => {
    setFailure('');
    if (root && path !== '/') setPath(parentOf(path));
    else if (root) { setRoot(null); setPath('/'); }
    else if (sources.length > 1) setSourceId(null);
  };
  const canGoBack = !!root || (!!source && sources.length > 1);

  return (
    <div>
      {source && canGoBack && (
        <button type="button" className="m-linkbtn" style={{ marginBottom: 6 }} onClick={back}>
          <Icon name="chevron-left" size={14}/> Back
        </button>
      )}
      {!source && sources.map(s => <Row key={s.id} icon={s.icon} title={s.label} sub={s.desc} chevron onClick={() => setSourceId(s.id)}/>)}
      {!source && sources.length === 0 && <Note>Nothing to choose from here.</Note>}
      {source && !root && <Roots source={source} onRoot={r => { setRoot(r); setPath('/'); }} onPick={onPick} onFail={setFailure} failure={failure}/>}
      {source && root && <Browser source={source} root={root} path={path} onPath={setPath} onPick={onPick} onFail={setFailure} failure={failure}/>}
    </div>
  );
}
