// editor-screen.jsx — the Editor module's screen on Android. It runs the same EditorApp as the
// desktop, against an in-app workspace: "Open file" imports a file from the device, "Open folder"
// shows the workspace, and Export hands a file back out.
import React from 'react';
import { EditorApp } from '@nexusmd/app-editor/editor-app';
import { createEditorStore } from '@nexusmd/app-editor/editor-store';
import { editorWorkspace, WORKSPACE_ROOT } from './adapters/editor-workspace.js';
import { pickerAdapter } from './adapters/picker.js';
import { createSafApi, createEditorApi, safAvailable } from './adapters/editor-saf.js';
import { getProfileKey } from './profile-keys.js';
import { Icon } from './icons.jsx';
import { toast } from './toast.jsx';
import { Sheet } from './components.jsx';

const storage = {
  get: key => { try { return localStorage.getItem(getProfileKey(key)); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(getProfileKey(key), value); } catch { /* ignore */ } },
};

const saf = createSafApi();
const editorApi = createEditorApi({ workspace: editorWorkspace, saf });
export const editorStore = createEditorStore({ api: editorApi, storage });
const useEditorStore = (store) => React.useSyncExternalStore(store.subscribe, store.getState);

// The picker the EditorApp opens files and folders with, mapped onto the workspace.
const host = {
  adapters: {
    picker: {
      async pickFile() {
        const f = await pickerAdapter.pickFile({});
        return f ? { path: await editorWorkspace.importFile(f.name, f.text) } : null;
      },
      // A real device folder where the native plugin is there, otherwise the in-app workspace.
      async pickDirectory() { return safAvailable() ? saf.pickFolder() : WORKSPACE_ROOT; },
    },
  },
};

function DesktopEditorScreen() {
  const s = useEditorStore(editorStore);
  const [name, setName] = React.useState('');
  const active = s.docs.find(d => d.path === s.active);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    // Inside the open folder, or the workspace when none is open.
    const path = `${s.folder || WORKSPACE_ROOT}/${n.split(/[\\/]/).join('_')}`;
    try {
      const r = await editorApi.write(path, '', { overwrite: false });
      // An existing file of that name is simply opened.
      if (r?.ok || r?.conflict) { setName(''); editorStore.openPath(path); }
      else toast('Could not create the file.', 'error');
    } catch (e) { toast(`Could not create the file. ${e?.message || ''}`.trim(), 'error'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexShrink: 0 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New file name"
          onKeyDown={e => { if (e.key === 'Enter') create(); }}
          style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }}/>
        <button type="button" className="btn sm" onClick={create} disabled={!name.trim()}>New</button>
        <button type="button" className="btn sm ghost" title="Open the in-app workspace" onClick={() => editorStore.openPath(WORKSPACE_ROOT)}>Workspace</button>
        <button type="button" className="btn sm" disabled={!active || active.status !== 'ready'}
          onClick={() => pickerAdapter.saveFile(active.name, active.text)}>Export</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <EditorApp host={host} store={editorStore} api={editorApi}/>
      </div>
    </div>
  );
}

// Phone: browse the workspace folder by folder, then open a file full screen. The tablet and
// desktop layout above is unchanged.
const BAD_NAME = /[\\/:*?"<>|]/;

function PhoneEditorScreen({ onFlash }) {
  const s = useEditorStore(editorStore);
  const [dir, setDir] = React.useState(WORKSPACE_ROOT);
  const [entries, setEntries] = React.useState(null);
  const [sheet, setSheet] = React.useState(false);
  const [name, setName] = React.useState('');
  const [nameError, setNameError] = React.useState('');
  const active = s.docs.find(d => d.path === s.active);

  const refresh = React.useCallback(() => {
    setEntries(null);
    editorApi.list(dir).then(r => setEntries(r?.entries || [])).catch(() => setEntries([]));
  }, [dir]);
  React.useEffect(refresh, [refresh, active]);

  const crumbs = dir.slice(WORKSPACE_ROOT.length).split('/').filter(Boolean);
  const up = () => setDir(dir.slice(0, dir.lastIndexOf('/')) || WORKSPACE_ROOT);

  const create = async () => {
    const n = name.trim();
    if (!n) return setNameError('Enter a name.');
    if (BAD_NAME.test(n)) return setNameError('A name cannot contain \\ / : * ? " < > |');
    const path = `${dir}/${n}`;
    try {
      const r = await editorApi.write(path, '', { overwrite: false });
      if (r?.conflict) return setNameError('A file with that name is already here.');
      if (r && r.ok === false) return setNameError('Could not create the file.');
      setSheet(false); setName(''); setNameError('');
      editorStore.openPath(path);
    } catch (e) { setNameError(e?.message || 'Could not create the file.'); }
  };
  const importFile = async () => {
    try {
      const p = await host.adapters.picker.pickFile();
      if (p) { setSheet(false); refresh(); editorStore.openPath(p.path); }
    } catch (e) { setNameError(e?.message || 'Could not import that file.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: active.name, text: active.text }); }
    catch (e) { if (e?.name !== 'AbortError') onFlash?.('Sharing is not available here'); }
  };

  if (active) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="m-appbar">
          <button type="button" className="m-iconbtn" aria-label="Back" onClick={() => editorStore.close(active.path)}><Icon name="chevron-left" size={18}/></button>
          <div className="m-ab-lead"><div><h1 style={{ fontSize: 16 }}>{active.name}</h1></div></div>
          <div className="m-ab-actions">
            {navigator.share && <button type="button" className="m-iconbtn" title="Share" disabled={active.status !== 'ready'} onClick={share}><Icon name="send" size={17}/></button>}
            <button type="button" className="m-linkbtn" disabled={active.status !== 'ready'}
              onClick={() => { pickerAdapter.saveFile(active.name, active.text); onFlash?.('Exported'); }}>Export</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}><EditorApp host={host} store={editorStore} api={editorApi}/></div>
      </div>
    );
  }

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead"><div><h1>Documents</h1><div className="m-ab-sub">{crumbs.length ? crumbs.join(' / ') : 'Workspace'}</div></div></div>
        <div className="m-ab-actions">
          <button type="button" className="m-iconbtn" aria-label="New or import" onClick={() => { setNameError(''); setSheet(true); }}><Icon name="plus" size={20}/></button>
        </div>
      </div>
      <div className="m-screen">
        {!entries && <div className="muted">Loading…</div>}
        {entries && (
          <div className="m-card flush">
            {dir !== WORKSPACE_ROOT && (
              <div className="m-row" onClick={up}><div className="m-row-main"><div className="m-row-title">Up one folder</div></div></div>
            )}
            {entries.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>This folder is empty.</div>}
            {entries.map(e => (
              <div key={e.name} className="m-row"
                onClick={() => (e.kind === 'dir' ? setDir(`${dir}/${e.name}`) : editorStore.openPath(`${dir}/${e.name}`))}>
                <span className="m-fileic"><Icon name={e.kind === 'dir' ? 'folder' : 'doc'} size={16}/></span>
                <div className="m-row-main"><div className="m-row-title">{e.name}</div></div>
                {e.kind === 'dir' && <Icon name="chevron-right" size={16} className="chev"/>}
              </div>
            ))}
          </div>
        )}
      </div>
      <Sheet open={sheet} icon="plus" title="New document" onClose={() => setSheet(false)}>
        <div className="m-fld">
          <label>Name</label>
          <input type="text" value={name} autoFocus placeholder="notes.md"
            onChange={e => { setName(e.target.value); setNameError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}/>
          {nameError && <div className="m-error" style={{ marginTop: 8 }}>{nameError}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost m-btn-lg" onClick={importFile}>Import from device</button>
          <button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={create}>Create</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Import copies a text file into this folder.</div>
      </Sheet>
    </>
  );
}

export function EditorScreen({ onFlash }) {
  const [phone, setPhone] = React.useState(() => window.matchMedia('(max-width:600px)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width:600px)');
    const h = e => setPhone(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return phone ? <PhoneEditorScreen onFlash={onFlash}/> : <DesktopEditorScreen/>;
}
