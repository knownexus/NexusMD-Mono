// shortcut-host.js — what a File-or-folder Home shortcut needs from the phone app: whether this device can open
// one, and how it is opened. The shortcut model is core's (shortcuts); the destinations consume the target
// from window.NexusMDNav.target (the git browser, the Documents page, the Editor).
import { resolveLink, repoKeys, LINK_UNAVAILABLE } from '@nexusmd/core';
import { getProfileKey } from './profile-keys.js';

export const PLATFORM = 'mobile';
const VIEW = { git: 'git', doc: 'markdown', editor: 'editor' };

// The phone browses GitHub and Azure DevOps repositories; a clone with another remote, or none, is not here.
const browsable = (repo) => repo.provider === 'github' || repo.provider === 'ado'
  || repoKeys(repo).some(k => k.startsWith('github.com/') || k.startsWith('dev.azure.com/'));

const idsAt = (key) => {
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    const list = Array.isArray(p) ? p : Array.isArray(p?.docs) ? p.docs : [];
    return list.filter(d => d && d.id).map(d => ({ id: d.id }));
  } catch { return []; }
};

// The saved documents of each tool. The phone's Markdown page keeps its documents under the bare key, the
// tablet layout under the profile's, so both are read.
const unique = (docs) => [...new Map(docs.map(d => [d.id, d])).values()];
export const savedDocs = () => ({
  markdown: unique([...idsAt(getProfileKey('md_documents')), ...idsAt('md_documents')]),
  json: unique(idsAt(getProfileKey('json_editor_documents'))),
});

export function resolveTarget(t) {
  if (t?.target === 'git') return browsable(t.repo || {}) ? { ok: true } : { ok: false, reason: LINK_UNAVAILABLE.repo };
  return resolveLink(t, { docs: savedDocs(), platform: PLATFORM });
}

export function openTarget(t) {
  const view = VIEW[t?.target];
  if (view) window.dispatchEvent(new CustomEvent('helm:navigate', { detail: { view, target: t } }));
}

// A destination takes its target once: it is cleared so a later visit to the page does not jump again.
export function takeTarget(kind) {
  const t = window.NexusMDNav?.target;
  if (!t || t.target !== kind) return null;
  window.NexusMDNav = { ...window.NexusMDNav, target: null };
  return t;
}
