import React from 'react'
import {
  ALL_PROJECTS, findGroup, scopeSnapshot, changeCount, renameGroup, duplicateGroup, deleteGroup, worktreeId, pruneSelection, commitTargets,
  actionTargets,
} from '@nexusmd/core'
import { setGitConfig, getGitConfig, effectiveRoots } from '../../git-config.js'
import { useGitConfig } from './use-git-config.js'
import { useGitSnapshot } from './use-git-snapshot.js'
import { GroupTabs } from './group-tabs.jsx'
import { RepoCards, GitSummary } from './repo-cards.jsx'
import { WorktreeDetail } from './worktree-detail.jsx'
import { WorktreePanel } from './worktree-panel.jsx'
import { HistoryPanel } from './history-panel.jsx'
import { useGitSync } from './use-git-sync.js'
import { ActionDialog, ActivityDrawer } from './action-dialog.jsx'
import { GroupMenu } from './group-menu.jsx'
import { GroupEditor } from './group-editor.jsx'
import { useGitActions, ipcMessage } from './use-git-actions.js'
import { ReviewDialog } from './review-dialog.jsx'
import { CommitDialog } from './commit-dialog.jsx'
import { RunDrawer } from '../shared/run-drawer.jsx'
import '../devenv-git.css'

const card = (text, role) => <div className={role === 'alert' ? 'nx-alert' : 'card'} role={role} style={{ padding: 16 }}>{text}</div>

// Commands the command line hands to the existing preview dialogs instead of running directly.
const VIA_SYNC = { fetch: {}, pull: { mode: 'ff' }, push: {} }
// Asked about before running: force flags (also bundled, as in -fd), --hard, -D, and commands that throw work away.
const RISKY = /(^|\s)(--force\S*|-f\w*|-\w*f|--hard|-D)(\s|$)|^(clean|reset|restore)\b|^stash (drop|clear)\b/

export function ViewGit({ adapters }) {
  const adapter = adapters?.git
  if (!adapter?.isAvailable()) return <div className="nx-empty" style={{ padding: 16 }}>Git Workspace needs the desktop app.</div>
  return <GitWorkspace adapter={adapter} />
}

function GitWorkspace({ adapter }) {
  const config = useGitConfig()
  const registered = React.useMemo(() => config.repos.map(r => r.path), [config.repos])
  const [gitVersion, setGitVersion] = React.useState(undefined)
  const [menuFor, setMenuFor] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  // Per worktree, for this session: which changes are ticked and which one shows its diff.
  const [selections, setSelections] = React.useState({})
  const [focus, setFocus] = React.useState({})
  // An open commit dialog: which worktrees start ticked (null = the selected one) and messages kept for a retry.
  const [committing, setCommitting] = React.useState(null)
  // The command line's last run, shown in the drawer.
  const [cmdRun, setCmdRun] = React.useState(null)
  const commits = React.useRef(0)
  // The worktree panel asks before its unsaved edits would be lost to a change of worktree or group.
  const panelRef = React.useRef(null)
  const mayLeave = () => panelRef.current?.confirmDiscard() ?? true
  React.useEffect(() => {
    let live = true
    adapter.version().then(v => { if (live) setGitVersion(v) }, () => { if (live) setGitVersion(null) })
    return () => { live = false }
  }, [adapter])
  const { snapshot, error, loading, refresh, reload } = useGitSnapshot({ adapter, repos: config.repos, enabled: !!gitVersion && !config.unsupported })
  const actions = useGitActions({ adapter, registered, reload })
  const sync = useGitSync({ adapter, registered, reload })

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

  const openCommit = (tickedIds = null, messages = {}) => setCommitting({ id: ++commits.current, tickedIds, messages })
  const commitList = committing
    ? commitTargets(scoped.worktrees, view.selected).map(t => (committing.tickedIds ? { ...t, ticked: !t.unavailable && committing.tickedIds.includes(t.id) } : t))
    : []

  const exec = async (tree, argv) => {
    const [verb] = argv
    if (Object.hasOwn(VIA_SYNC, verb) && argv.length === 1) return sync.open(verb, actionTargets(verb, [tree], worktreeId(tree)), VIA_SYNC[verb])
    const line = argv.join(' ')
    if (RISKY.test(line) && !window.confirm(`Run "git ${line}" in ${tree.path}? This can't be undone from NexusMD.`)) return
    const title = `git ${line}`
    const head = { text: `$ git ${line}`, tone: 'cmd' }
    if (!adapter.exec) { setCmdRun({ title, status: 'failed', lines: [head, { text: "This version of NexusMD can't run git commands. Update the desktop app.", tone: 'bad' }] }); return }
    setCmdRun({ title, status: 'running', lines: [head] })
    try {
      const r = await adapter.exec({ name: tree.repo, path: tree.repoRoot }, tree.path, registered, argv)
      const toLines = (s, tone) => (s ? s.replace(/\n$/, '').split('\n').map(text => ({ text, tone })) : [])
      setCmdRun({ title, status: r.code === 0 ? 'done' : 'failed', exitCode: r.code, lines: [head, ...toLines(r.stdout), ...toLines(r.stderr, r.code === 0 ? 'muted' : 'bad')] })
    } catch (e) {
      setCmdRun({ title, status: 'failed', lines: [head, { text: ipcMessage(e), tone: 'bad' }] })
    }
    reload()
  }

  const listHidden = view.list === 'hidden'
  return (
    <div className="nx-shell">
    <div className="nx-page">
      <header className="nx-head">
        <div>
          <div className="nx-eyebrow">Workspace</div>
          <h2 className="nx-title">Git Workspace</h2>
        </div>
        <div className="nx-head-actions">
          <span className="nx-subtle" style={{ fontSize: 12 }}>
            {loading ? 'Refreshing…' : snapshot ? `Updated ${new Date(snapshot.takenAt).toLocaleTimeString()}` : ''}
          </span>
          <button className="btn sm ghost" aria-pressed={!listHidden} title={listHidden ? 'Show the repository list beside the details' : 'Hide the repository list to give the details the full width'}
            onClick={() => setView({ list: listHidden ? 'shown' : 'hidden' })}>{listHidden ? 'Show repositories' : 'Hide repositories'}</button>
          <button className="btn sm ghost" aria-label="Refresh" onClick={refresh}>Refresh</button>
          <button className="btn sm ghost" title="git fetch --all --prune" disabled={!scoped.worktrees.length} onClick={() => sync.open('fetch', actionTargets('fetch', scoped.worktrees, null))}>Fetch all</button>
          <button className="btn sm" title="git pull --ff-only in every worktree" disabled={!scoped.worktrees.length} onClick={() => sync.open('pull', actionTargets('pull', scoped.worktrees, null), { mode: 'ff', batch: true })}>Pull all</button>
        </div>
      </header>

      <GroupTabs tabs={tabs} active={group ? group.name : ALL_PROJECTS}
        onSelect={name => { if (mayLeave()) setView({ group: name, selected: null }) }}
        onNew={() => setEditing({ name: null })} onMenu={setMenuFor} busy={editBusy} />

      {snapshot && <GitSummary worktrees={scoped.worktrees} />}
      {error && card(error, 'alert')}
      {!config.repos.length && card(roots.length
        ? `No repositories yet. Add one in Settings → Desktop → Git Workspace, or create a group to pick from ${roots.join('; ')}.`
        : 'No repositories yet. Add repositories in Settings → Desktop → Git Workspace.')}

      <div className="nx-split" data-list={listHidden ? 'hidden' : 'shown'}>
        {!listHidden && <RepoCards repos={config.repos} scoped={scoped} errors={snapshot?.errors || []} collapsed={view.collapsed}
          onToggleRepo={name => setView({ collapsed: view.collapsed.includes(name) ? view.collapsed.filter(n => n !== name) : [...view.collapsed, name] })}
          selected={view.selected} onSelect={s => { if (s.id !== view.selected && mayLeave()) setView({ selected: s.id }) }} />}
        <aside aria-label="Details" className="card nx-panel">
          {selectedTree
            ? (
              <WorktreePanel ref={panelRef} adapter={adapter} repo={{ name: selectedTree.repo, path: selectedTree.repoRoot }} registered={registered}
                version={snapshot?.takenAt} tree={selectedTree} selected={selectedIds} focusId={focusId}
                onSelectionChange={ids => setSelections(s => ({ ...s, [treeKey]: ids }))}
                onFocus={id => setFocus(f => ({ ...f, [treeKey]: id }))}
                onAction={action => actions.openReview(action, selectedTree, selectedIds)} onCommit={() => openCommit()}
                onHunk={(change, index, stamp, after) => actions.hunk(selectedTree, change, index, stamp, after)}
                busy={!!actions.busy[selectedTree.path] || cmdRun?.status === 'running'} status={actions.status[selectedTree.path] ?? null}
                split={view.split} onSplit={split => setView({ split })}
                panel={view.panel} onPanel={panel => setView({ panel })}
                onSync={(kind, options) => sync.open(kind, actionTargets(kind, [selectedTree], treeKey), options)}
                onExec={exec} onSaved={reload} />
            )
            : (
              <div style={{ padding: 16 }}>
                <BranchHistory adapter={adapter} branch={selectedBranch} repos={config.repos} worktrees={snapshot?.worktrees ?? []}
                  registered={registered} split={view.split} onSplit={split => setView({ split })} />
              </div>
            )}
        </aside>
      </div>

      <ActivityDrawer sync={sync} />
      <ActionDialog sync={sync} adapter={adapter} registered={registered} />
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
          onDelete={() => {
            if (view.group === menuFor && !mayLeave()) return
            save(deleteGroup(getGitConfig(), menuFor))
            if (view.group === menuFor) setView({ group: ALL_PROJECTS, selected: null })
          }} />
      )}
      <GroupEditor open={!!editing} config={config} snapshot={snapshot} existing={editingGroup} adapter={adapter}
        onClose={() => setEditing(null)}
        onDelete={editingGroup ? () => {
          if (view.group === editingGroup.name && !mayLeave()) return
          save(deleteGroup(getGitConfig(), editingGroup.name))
          if (view.group === editingGroup.name) setView({ group: ALL_PROJECTS, selected: null })
          setEditing(null)
        } : null}
        onSaved={(next, saved) => {
          // A changed repo list already reloads the snapshot; refreshing too would poll twice.
          const reposChanged = JSON.stringify(next.repos) !== JSON.stringify(getGitConfig().repos)
          save(next)
          // Declining keeps the saved group but leaves the open worktree (and its edits) on screen.
          if (mayLeave()) setView({ group: saved.name, selected: null })
          setEditing(null)
          if (!reposChanged) refresh()
        }} />
      <ReviewDialog key={actions.review?.id ?? 'none'} state={actions.review} onClose={actions.closeReview} onConfirm={actions.confirm} />
      {committing && (
        <CommitDialog key={committing.id} targets={commitList} adapter={adapter} registered={registered} initialMessages={committing.messages}
          onClose={() => setCommitting(null)} onDone={reload}
          onRetry={async (failedIds, messages) => { setCommitting(null); await reload(); openCommit(failedIds, messages) }} />
      )}
    </div>
      {cmdRun && <RunDrawer eyebrow="Git" title={cmdRun.title} status={cmdRun.status} lines={cmdRun.lines} exitCode={cmdRun.exitCode} onClose={() => setCmdRun(null)} />}
    </div>
  )
}

// A branch that isn't checked out has no changes, only history. git runs in any usable worktree
// of its repository, or in the common dir (the bare entry) of a layout with none.
function BranchHistory({ adapter, branch, repos, worktrees, registered, split, onSplit }) {
  const repo = branch ? repos.find(r => r.name === branch.repo) : null
  if (!branch || !repo) return <WorktreeDetail tree={null} branch={branch} />
  const cwd = worktrees.find(t => t.repo === branch.repo && !t.prunable && !t.error)?.path ?? branch.commonDir
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WorktreeDetail tree={null} branch={branch} />
      <HistoryPanel key={branch.id} adapter={adapter} repo={repo} cwd={cwd} registered={registered}
        target={{ ref: branch.ref, head: branch.head || null }} split={split} onSplit={onSplit} />
    </div>
  )
}
