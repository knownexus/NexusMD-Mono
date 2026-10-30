// editor-workspace.js — the file API the Editor app expects (stat / read / write / list), backed by
// a workspace inside the app. Android gives a WebView app no free filesystem, so files are imported
// into the workspace, edited and saved there, and exported back out. The contract mirrors the
// desktop main-process one (modules/editor/src/main/editor-files.cjs): a read carries a stamp, and
// a save based on an older stamp is reported as a conflict instead of overwriting.
import { createVirtualFs } from './api-file.js';

export const WORKSPACE_ROOT = '/editor';
const MAX_BYTES = 5 * 1024 * 1024;
const BOM = '﻿';

// FNV-1a over the text: only has to tell "changed" from "unchanged".
export function stampOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}-${text.length}`;
}

export function createEditorWorkspace(fs = createVirtualFs(localStorage, 'helm.android.editorfs:')) {
  return {
    fs,
    stat: (p) => fs.stat(p),

    async read(p) {
      if (!(await fs.exists(p))) return { missing: true };
      const raw = await fs.read(p);
      if (raw.length > MAX_BYTES) throw new Error('That file is too large to open here.');
      if (raw.includes('\0')) throw new Error('Only text files can be opened.');
      const bom = raw.startsWith(BOM);
      return { text: bom ? raw.slice(1) : raw, bom, stamp: stampOf(raw), path: p };
    },

    async write(p, text, { expectedStamp = null, overwrite = false, bom = false } = {}) {
      if (typeof text !== 'string') throw new Error('Nothing to write.');
      const body = (bom ? BOM : '') + text;
      if (body.length > MAX_BYTES) throw new Error('That file is too large to save from here.');
      if (await fs.exists(p)) {
        const stamp = stampOf(await fs.read(p));
        if (!overwrite && stamp !== expectedStamp) return { ok: false, conflict: true, stamp };
      } else if (expectedStamp != null && !overwrite) {
        return { ok: false, missing: true };
      }
      await fs.write(p, body);
      return { ok: true, stamp: stampOf(body), path: p };
    },

    // Folders first, then files, each alphabetical.
    async list(dir) {
      const base = String(dir).replace(/\/+$/, '');
      if (!(await fs.exists(base))) await fs.mkdir(base);
      const entries = await Promise.all((await fs.list(base)).map(async (name) => {
        const st = await fs.stat(`${base}/${name}`);
        return { name, kind: st.kind || 'other', size: st.size };
      }));
      entries.sort((a, b) => (a.kind === 'dir') !== (b.kind === 'dir')
        ? (a.kind === 'dir' ? -1 : 1)
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      return { path: base, entries, truncated: false };
    },

    // Brings a picked device file into the workspace and returns its path there.
    async importFile(name, text) {
      const safe = String(name).replace(/[\\/]/g, '_');
      const p = `${WORKSPACE_ROOT}/${safe}`;
      await fs.write(p, text);
      return p;
    },
  };
}

export const editorWorkspace = createEditorWorkspace();
