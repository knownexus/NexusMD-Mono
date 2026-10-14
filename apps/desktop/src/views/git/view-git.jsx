import React from 'react'
import {
  ALL_PROJECTS, findGroup, scopeSnapshot, changeCount, renameGroup, duplicateGroup, deleteGroup, worktreeId, pruneSelection,
} from '@nexusmd/core'
import { setGitConfig, getGitConfig, effectiveRoots } from '../../git-config.js'
import { useGitConfig } from './use-git-config.js'
import { useGitSnapshot } from './use-git-snapshot.js'
import { GroupTabs } from './group-tabs.jsx'
import { WorktreeList } from './worktree-list.jsx'
import { WorktreeDetail } from './worktree-detail.jsx'
import { WorktreePanel } from './worktree-panel.jsx'
import { GroupMenu } from './group-menu.jsx'
import { GroupEditor } from './group-editor.jsx'

const card = (text, role) => <div className="card" role={role} style={{ padding: 16 }}>{text}</div>

export function ViewGit({ adapters }) {
  const adapter = adapters?.git
  if (!adapter?.isAvailable()) return <div style={{ padding: 16 }}>Git Workspace needs the desktop app.</div>
  return <GitWorkspace adapter={adapter} />
}

function GitWorkspace({ adapter }) {
  const config = useGitConfig()
  const [gitVersion, setGitVersion] = React.useState(undefined)
  const [menuFor, setMenuFor] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  // Per worktree, for this session: which changes are ticked and which one shows its diff.
  const [selections, setSelections] = React.useState({})
  const [focus, setFocus] = React.useState({})
  React.useEffect(() => {
    let live = true
    adapter.version().then(v => { if (live) setGitVersion(v) }, () => { if (live) setGitVersion(null) })
    return () => { live = false }
  }, [adapter])
  const { snapshot, error, loading, refresh } = useGitSnapshot({ adapter, repos: config.repos, enabled: !!gitVersion && !config.unsupported })

  if (config.unsupported) return card(`These Git Workspace settings were saved by a newer NexusMD (version ${config.unsupported}). Update NexusMD to use them.`, 'alert')
  if (gitVersion === null) return card('Git not found. Install Git for Windows (git-scm.com) and make sure git is on PATH, then reopen this screen.', 'alert')
  if (gitVersion === undefined) return card('Checking for git…')

  const view = config.view
  const editingGroup = editing?.name ? config.groups.find(g => g.name === editing.name) ?? null : null
  const group = findGroup(config, view.group)
  const scoped = scopeSnapshot(snapshot, group)
  const tabs = [
    { name: ALL_PROJECTS, count: changeCount(snapshot, null), editable: false },
    ...config.groups.map(g => ({ name: g.name, count: changeCount(snapshot, g), editable: true })),
  ]
  const setView = patch => setGitConfig({ view: { ...getGitConfig().view, ...patch } })
  const selectedTree = scoped.worktrees.find(t => worktreeId(t) === view.selected)
  const selectedBranch = scoped.inactiveBranches.find(b => b.id === view.selected)
  const treeKey = selectedTree ? worktreeId(selectedTree) : null
  const selectedIds = selectedTree ? pruneSelection(selections[treeKey] ?? [], selectedTree.changes) : []
  const focusId = selectedTree && selectedTree.changes.some(c => c.id === focus[treeKey]) ? focus[treeKey] : null
  const save = next => setGitConfig({ repos: next.repos, groups: next.groups })
  // The group editor builds its tree from the snapshot, so it waits for the first one.
  const editBusy = snapshot ? null : 'Loading repositories…'
  const roots = effectiveRoots(config)
  const tryName = fn => value => { try { save(fn(getGitConfig(), value)); return null } catch (e) { return e.message } }

  return (
    <div style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GroupTabs tabs={tabs} active={group ? group.name : ALL_PROJECTS}
            onSelect={name => setView({ group: name, selected: null })}
            onNew={() => setEditing({ name: null })} onMenu={setMenuFor} busy={editBusy} />
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {loading ? 'Refreshing…' : snapshot ? `Updated ${new Date(snapshot.takenAt).toLocaleTimeString()}` : ''}
        </span>
        <button className="btn sm ghost" aria-label="Refresh" onClick={refresh}>⟳</button>
      </div>
      {error && card(error, 'alert')}
      {!config.repos.length && card(roots.length
        ? `No repositories yet. Add one in Settings → Desktop → Git Workspace, or create a group to pick from ${roots.join('; ')}.`
        : 'No repositories yet. Add repositories in Settings → Desktop → Git Workspace.')}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: 12, alignItems: 'start' }}>
        <WorktreeList repos={config.repos} scoped={scoped} errors={snapshot?.errors || []} collapsed={view.collapsed}
          onToggleRepo={name => setView({ collapsed: view.collapsed.includes(name) ? view.collapsed.filter(n => n !== name) : [...view.collapsed, name] })}
          selected={view.selected} onSelect={s => setView({ selected: s.id })} />
        <aside aria-label="Details" className="card" style={{ padding: 12, minWidth: 0 }}>
          {selectedTree
            ? (
              <WorktreePanel tree={selectedTree} selected={selectedIds} focusId={focusId}
                onSelectionChange={ids => setSelections(s => ({ ...s, [treeKey]: ids }))}
                onFocus={id => setFocus(f => ({ ...f, [treeKey]: id }))}
                onAction={() => {}} onCommit={() => {}} busy={false} status={null} />
            )
            : <WorktreeDetail tree={null} branch={selectedBranch} />}
        </aside>
      </div>
      {menuFor && (
        <GroupMenu name={menuFor} onClose={() => setMenuFor(null)} editBusy={editBusy}
          onEdit={() => setEditing({ name: menuFor })}
          onRename={value => {
            try {
              const cfg = getGitConfig()
              const next = renameGroup(cfg, menuFor, value)
              const renamed = next.groups.find(g => g.name.toLowerCase() === value.trim().toLowerCase())
              setGitConfig({ repos: next.repos, groups: next.groups,
                view: cfg.view.group === menuFor ? { ...cfg.view, group: renamed ? renamed.name : value.trim() } : cfg.view })
              return null
            } catch (e) { return e.message }
          }}
          onDuplicate={tryName((cfg, value) => duplicateGroup(cfg, menuFor, value))}
          onDelete={() => { save(deleteGroup(getGitConfig(), menuFor)); if (view.group === menuFor) setView({ group: ALL_PROJECTS, selected: null }) }} />
      )}
      <GroupEditor open={!!editing} config={config} snapshot={snapshot} existing={editingGroup} adapter={adapter}
        onClose={() => setEditing(null)}
        onSaved={(next, saved) => {
          // A changed repo list already reloads the snapshot; refreshing too would poll twice.
          const reposChanged = JSON.stringify(next.repos) !== JSON.stringify(getGitConfig().repos)
          save(next)
          setView({ group: saved.name, selected: null })
          setEditing(null)
          if (!reposChanged) refresh()
        }} />
    </div>
  )
}
