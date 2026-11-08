// git-layers.js — the Repos screen's layers as browser-history entries, so the Android back gesture
// (which is history back) goes up one layer: file, then its folder, then the folders above it, then the
// repository list, rather than leaving the tab. A layer is where the screen is:
//   { repo, branch, tab, path, file, sheet }
// repo is a repository id (null on the list), tab is 'files' or 'commits', path is the open folder, file
// the open file, and sheet 'branch' or 'commit:<id>' while one is over the screen.

export const ROOT_LAYER = Object.freeze({ repo: null, branch: null, tab: 'files', path: '/', file: null, sheet: null });

const text = (v, fallback) => (typeof v === 'string' ? v : fallback);

// The layer saved in a history entry's state; the list when there is none (or it is another page's).
export function readLayer(state) {
  const g = state && typeof state === 'object' ? state.git : null;
  if (!g || typeof g !== 'object') return ROOT_LAYER;
  return {
    repo: text(g.repo, null), branch: text(g.branch, null), tab: g.tab === 'commits' ? 'commits' : 'files',
    path: text(g.path, '/'), file: text(g.file, null), sheet: text(g.sheet, null),
  };
}

// How many entries above the list's own the entry is: the layers a "Back to repositories" has to climb.
export function readDepth(state) {
  const d = state && typeof state === 'object' ? state.depth : 0;
  return Number.isInteger(d) && d > 0 ? d : 0;
}

// The layer for what the screen holds. With no repository open it is the list, whatever else was left set.
export function layerOf({ repo, branch, tab, path, file, sheet }) {
  if (!repo) return ROOT_LAYER;
  return { repo: repo.id, branch: branch ?? null, tab, path, file: file ?? null, sheet: sheet ?? null };
}

// Whether two layers are the same place. The tab and the branch are settings of a place, not places of
// their own: changing them is not something the back gesture should undo step by step.
export const samePlace = (a, b) => a.repo === b.repo && a.path === b.path && a.file === b.file && a.sheet === b.sheet;

// What the screen's move from the history entry `entry` to the layer `next` does to the history:
// 'none' (already it), 'replace' (the entry is rewritten, nothing added), or 'push' (a new place).
// A sheet that the screen itself dropped (a branch was picked in it) rewrites its entry, so the sheet
// is not left behind to be swiped back to.
export function historyAction(entry, next) {
  if (samePlace(entry, next)) return entry.tab === next.tab && entry.branch === next.branch ? 'none' : 'replace';
  return entry.sheet && !next.sheet ? 'replace' : 'push';
}
