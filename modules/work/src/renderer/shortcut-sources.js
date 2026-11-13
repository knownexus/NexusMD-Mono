// shortcut-sources.js — what the desktop Dashboard can offer when making a File-or-folder shortcut in the Add widget sheet (the
// shape is documented in @nexusmd/ui's target-picker.jsx). Each kind is offered only when the app behind it is installed:
// a file or folder of a repository registered in Git Workspace, a saved Markdown or JSON document, or any file or folder of
// this computer (for the Editor). Apps never import each other, so everything comes through their capabilities.
import { childrenAt, cloneRepoIdentity, savedDocList } from '@nexusmd/core'
import { relativeTime } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'

export const PLATFORM = 'desktop'

// A repository's file list is asked of git once for a while, so going in and out of its folders is quick.
const FILES_TTL = 30_000

const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || ''
const remoteLabel = (remote) => remote.replace(/^[^/]+\//, '')

export function createTargetSources({ caps, picker = null, storage = globalThis.localStorage, now = Date.now } = {}) {
  const has = (name) => !!caps?.has?.(name)
  const sources = []

  if (has('git.listRepos') && has('git.listFiles')) {
    const files = new Map() // repository path → { at, promise }
    const filesOf = (path) => {
      const hit = files.get(path)
      if (hit && now() - hit.at < FILES_TTL) return hit.promise
      const promise = Promise.resolve(caps.call('git.listFiles', path)).then(r => r.files).catch(e => { files.delete(path); throw e })
      files.set(path, { at: now(), promise })
      return promise
    }
    sources.push({
      id: 'git', label: 'Repository file or folder', desc: 'A repository registered in Git Workspace', icon: 'git-branch',
      empty: 'No repositories are registered in Git Workspace.',
      roots: async () => (await caps.call('git.listRepos')).map(r => ({ id: r.path, title: r.name, sub: r.remote ? remoteLabel(r.remote) : r.path, repo: r })),
      list: async (root, path) => childrenAt(await filesOf(root.id), path),
      toTarget: (root, entry) => ({
        target: 'git', kind: entry && !entry.isFolder ? 'file' : 'folder', path: entry?.path ?? '/',
        repo: cloneRepoIdentity({ name: root.repo.name, remote: root.repo.remote }),
      }),
    })
  }

  if (has('documents.openDoc')) {
    const docs = (tool, label, desc, key) => ({
      id: `doc-${tool}`, label, desc, icon: 'doc', empty: 'No saved documents yet.',
      roots: async () => savedDocList(storage.getItem(getProfileKey(key)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(d => ({ id: d.id, title: d.name || 'Untitled', sub: d.updatedAt ? relativeTime(d.updatedAt) : '' })),
      toTarget: (root) => ({ target: 'doc', tool, docId: root.id, name: root.title }),
    })
    sources.push(docs('markdown', 'Markdown document', 'A saved Markdown document', 'md_documents'))
    sources.push(docs('json', 'JSON document', 'A saved JSON document', 'json_editor_documents'))
  }

  if (has('editor.openPath') && picker) {
    sources.push({
      id: 'editor', label: 'Editor file or folder', desc: 'Anywhere on this computer', icon: 'doc',
      roots: async () => [
        { id: 'file', title: 'Choose a file…', sub: 'Pick one from this computer' },
        { id: 'folder', title: 'Choose a folder…', sub: 'Pick one from this computer' },
      ],
      // The operating system's own dialog; nothing when it is cancelled.
      toTarget: async (root) => {
        const path = root.id === 'file' ? (await picker.pickFile({ pathOnly: true }))?.path : await picker.pickDirectory()
        return path ? { target: 'editor', kind: root.id, path, name: baseName(path), platform: PLATFORM } : null
      },
    })
  }

  return sources
}
