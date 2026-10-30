// editor-saf.js — the Editor's file API over real device folders, through the SafFolder native
// plugin (Storage Access Framework; see SafFolderPlugin.java). The user grants a folder once; its
// files then open and save in place. Editor paths for those files are `/saf/<folder id>/<relative>`,
// so the rest of the Editor treats them like any other absolute path. Anything else goes to the
// in-app workspace (editor-workspace.js), which is also the fallback where the plugin is missing.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { stampOf } from './editor-workspace.js';

export const SAF_ROOT = '/saf';
const REGISTRY_KEY = 'helm.android.editor.safFolders';
const MAX_BYTES = 5 * 1024 * 1024;
const BOM = '﻿';

export const safPlugin = registerPlugin('SafFolder');
export const safAvailable = () => Capacitor.isNativePlatform();

const compareEntries = (a, b) => (a.kind === 'dir') !== (b.kind === 'dir')
  ? (a.kind === 'dir' ? -1 : 1)
  : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

export function createSafApi({ plugin = safPlugin, storage = localStorage } = {}) {
  // Granted folders: id (what the path shows) -> { uri, name }.
  const read = () => { try { return JSON.parse(storage.getItem(REGISTRY_KEY) || '{}'); } catch { return {}; } };
  const write = (reg) => { try { storage.setItem(REGISTRY_KEY, JSON.stringify(reg)); } catch { /* kept for this session */ } };

  // Splits `/saf/<id>/a/b` into the folder's tree URI and `a/b`.
  function locate(p) {
    const rest = String(p).slice(SAF_ROOT.length).replace(/^\/+/, '');
    const [id, ...parts] = rest.split('/');
    const folder = read()[id];
    if (!folder) throw new Error('That folder is no longer available. Open it again.');
    return { tree: folder.uri, path: parts.join('/') };
  }

  return {
    isSafPath: (p) => String(p).startsWith(`${SAF_ROOT}/`),

    // Asks the user for a folder; returns its editor path, or null if they backed out.
    async pickFolder() {
      const r = await plugin.pickFolder();
      if (!r || r.cancelled || !r.uri) return null;
      const reg = read();
      let id = Object.keys(reg).find(k => reg[k].uri === r.uri);
      if (!id) {
        const base = String(r.name || 'Folder').replace(/[\\/]/g, '_');
        id = base;
        for (let n = 2; reg[id]; n++) id = `${base} (${n})`;
        reg[id] = { uri: r.uri, name: r.name };
        write(reg);
      }
      return `${SAF_ROOT}/${id}`;
    },

    async stat(p) {
      const { tree, path } = locate(p);
      return plugin.stat({ tree, path });
    },

    async read(p) {
      const { tree, path } = locate(p);
      const r = await plugin.readText({ tree, path });
      if (r.missing) return { missing: true };
      const raw = r.text;
      if (raw.length > MAX_BYTES) throw new Error('That file is too large to open here.');
      if (raw.includes('\0')) throw new Error('Only text files can be opened.');
      const bom = raw.startsWith(BOM);
      return { text: bom ? raw.slice(1) : raw, bom, stamp: stampOf(raw), path: p };
    },

    async write(p, text, { expectedStamp = null, overwrite = false, bom = false } = {}) {
      if (typeof text !== 'string') throw new Error('Nothing to write.');
      const { tree, path } = locate(p);
      const body = (bom ? BOM : '') + text;
      if (body.length > MAX_BYTES) throw new Error('That file is too large to save from here.');
      const current = await plugin.readText({ tree, path });
      if (!current.missing) {
        const stamp = stampOf(current.text);
        if (!overwrite && stamp !== expectedStamp) return { ok: false, conflict: true, stamp };
      } else if (expectedStamp != null && !overwrite) {
        return { ok: false, missing: true };
      }
      await plugin.writeText({ tree, path, text: body });
      return { ok: true, stamp: stampOf(body), path: p };
    },

    async list(p) {
      const { tree, path } = locate(p);
      const { entries } = await plugin.list({ tree, path });
      return { path: p, entries: [...entries].sort(compareEntries), truncated: false };
    },

  };
}

// One api for the Editor: `/saf/...` paths to the device folders, everything else to the workspace.
export function createEditorApi({ workspace, saf }) {
  const pick = (p) => (saf.isSafPath(p) ? saf : workspace);
  return {
    stat: (p) => pick(p).stat(p),
    read: (p) => pick(p).read(p),
    write: (p, text, options) => pick(p).write(p, text, options),
    list: (p) => pick(p).list(p),
  };
}
