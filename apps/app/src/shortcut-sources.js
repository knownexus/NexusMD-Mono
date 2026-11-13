// shortcut-sources.js — what the phone can offer when making a File-or-folder shortcut in the Add widget sheet (the shape
// is documented in @nexusmd/ui's target-picker.jsx): a repository file or folder (GitHub or Azure DevOps, on the default
// branch), a saved Markdown or JSON document, or a file or folder of the Editor's workspace.
import { relativeTime } from '@nexusmd/ui';
import { listRepoChoices, listRepoFolder } from './git-view.jsx';
import { listEditorFolder } from './editor-screen.jsx';
import { WORKSPACE_ROOT } from './adapters/editor-workspace.js';
import { listSavedDocs, repoIdentity, PLATFORM } from './shortcut-host.js';

const docSource = (tool, label, desc) => ({
  id: `doc-${tool}`, label, desc, icon: 'doc', empty: 'No saved documents yet.',
  roots: async () => listSavedDocs(tool).map(d => ({ id: d.id, title: d.name || 'Untitled', sub: d.updatedAt ? relativeTime(d.updatedAt) : '' })),
  toTarget: (root) => ({ target: 'doc', tool, docId: root.id, name: root.title }),
});

// A path inside the workspace, from the picker's path inside it ('/' for the workspace itself).
const inWorkspace = (path) => (path === '/' ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}${path}`);

export const targetSources = [
  {
    id: 'git', label: 'Repository file or folder', desc: 'On GitHub or Azure DevOps', icon: 'git-branch', empty: 'No repositories are connected.',
    roots: async () => ((await listRepoChoices()).repos || []).map(r => ({ id: r.id, title: r.name, sub: r.project, repo: r })),
    list: (root, path) => listRepoFolder(root.repo, path),
    toTarget: (root, entry) => ({
      target: 'git', kind: entry && !entry.isFolder ? 'file' : 'folder', path: entry?.path ?? '/', repo: repoIdentity(root.repo),
    }),
  },
  docSource('markdown', 'Markdown document', 'A saved Markdown document'),
  docSource('json', 'JSON document', 'A saved JSON document'),
  {
    id: 'editor', label: 'Editor file or folder', desc: 'In the Editor’s workspace', icon: 'doc',
    roots: async () => [{ id: WORKSPACE_ROOT, title: 'Workspace' }],
    list: async (root, path) => (await listEditorFolder(inWorkspace(path))).map(e => ({
      name: e.name, path: `${path === '/' ? '' : path}/${e.name}`, isFolder: e.kind === 'dir',
    })),
    toTarget: (root, entry) => ({
      target: 'editor', kind: entry && !entry.isFolder ? 'file' : 'folder', path: inWorkspace(entry?.path ?? '/'),
      name: entry?.name || 'Workspace', platform: PLATFORM,
    }),
  },
];
