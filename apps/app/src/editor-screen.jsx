// editor-screen.jsx — the Editor module's screen on Android. It runs the same EditorApp as the
// desktop, against an in-app workspace: "Open file" imports a file from the device, "Open folder"
// shows the workspace, and Export hands a file back out.
import React from 'react';
import { EditorApp } from '@nexusmd/app-editor/editor-app';
import { createEditorStore } from '@nexusmd/app-editor/editor-store';
import { editorWorkspace, WORKSPACE_ROOT } from './adapters/editor-workspace.js';
import { pickerAdapter } from './adapters/picker.js';
import { getProfileKey } from './profile-keys.js';

const storage = {
  get: key => { try { return localStorage.getItem(getProfileKey(key)); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(getProfileKey(key), value); } catch { /* ignore */ } },
};

export const editorStore = createEditorStore({ api: editorWorkspace, storage });
const useEditorStore = (store) => React.useSyncExternalStore(store.subscribe, store.getState);

// The picker the EditorApp opens files and folders with, mapped onto the workspace.
const host = {
  adapters: {
    picker: {
      async pickFile() {
        const f = await pickerAdapter.pickFile({});
        return f ? { path: await editorWorkspace.importFile(f.name, f.text) } : null;
      },
      async pickDirectory() { return WORKSPACE_ROOT; },
    },
  },
};

export function EditorScreen() {
  const s = useEditorStore(editorStore);
  const [name, setName] = React.useState('');
  const active = s.docs.find(d => d.path === s.active);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const path = await editorWorkspace.importFile(n, '');
    setName('');
    editorStore.openPath(path);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexShrink: 0 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New file name"
          onKeyDown={e => { if (e.key === 'Enter') create(); }}
          style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }}/>
        <button type="button" className="btn sm" onClick={create} disabled={!name.trim()}>New</button>
        <button type="button" className="btn sm" disabled={!active || active.status !== 'ready'}
          onClick={() => pickerAdapter.saveFile(active.name, active.text)}>Export</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <EditorApp host={host} store={editorStore} api={editorWorkspace}/>
      </div>
    </div>
  );
}
