import React from 'react'
import {
  ALL_PROJECTS, findGroup, scopeSnapshot, renameGroup, duplicateGroup, deleteGroup, worktreeId, pruneSelection, commitTargets,
  actionTargets, branchState,
} from '@nexusmd/core'
import { setGitConfig, getGitConfig, effectiveRoots, effectiveDotfiles } from '../../git-config.js'
import { useGitConfig } from './use-git-config.js'
import { useGitSnapshot } from './use-git-snapshot.js'
import { GroupTabs } from './group-tabs.jsx'
import { BranchList } from './branch-list.jsx'
import { FilterChips, BranchSearch } from './filter-chips.jsx'
import { BranchSwitcher } from './branch-switcher.jsx'
import { AttentionOverview } from './attention-overview.jsx'
import { allFetchedText } from './fetched-ago.js'
import { WorktreeDetail } from './worktree-detail.jsx'
import { WorktreePanel } from './worktree-panel.jsx'
import { HistoryPanel } from './history-panel.jsx'
import { useGitSync } from './use-git-sync.js'
import { ActionDialog, ActivityDrawer } from './action-dialog.jsx'
import { GroupMenu, GroupMenuButton } from './group-menu.jsx'
import { GroupEditor } from './group-editor.jsx'
import { useGitActions, ipcMessage } from './use-git-actions.js'
import { ReviewDialog } from './review-dialog.jsx'
import { CommitDialog } from './commit-dialog.jsx'
import { RunDrawer } from '../shared/run-drawer.jsx'
import '../devenv-git.css'
import './git-workspace.css'

const card = (text, role) => <div className={role === 'alert' ? 'nx-alert' : 'card'} role={role} style={{ padding: 16 }}>{text}</div>

// Commands the command line hands to the existing preview dialogs instead of running directly.
const VIA_SYNC = { fetch: {}, pull: { mode: 'ff' }, push: {} }
// Asked about before running: force flags (also bundled, as in -fd), --hard, -D, and commands that throw work away.
const RISKY = /(^|\s)(--force\S*|-f\w*|-\w*f|--hard|-D)(\s|$)|^(clean|reset|restore)\b|^stash (drop|clear)\b/

// When a snapshot was read: the time, with the day too when it wasn't today.
function readAt(iso) {
  const d = new Date(iso)
  const today = d.toDateString() === new Date().toDateString()
  return today ? d.toLocaleTimeString() : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

export function ViewGit({ adapters }) {
  const adapter = adapters?.git
  if (!adapter?.isAvailable()) return <div className="nx-empty" style={{ padding: 16 }}>Git Workspace needs the desktop app.</div>
  return <GitWorkspace adapter={adapter} />
}

function GitWorkspace({ adapter }) {
  const config = useGitConfig()
  const registered = React.useMemo(() => config.repos.map(r => r.path), [config.repos])
  const [gitVersion, setGitVersion] = React.useState(undefined)
  // A group dialog from the ⋯ menu: { name, mode: rename | duplicate | delete }.
  const [menuFor, setMenuFor] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  // The branch list's chip (a BRANCH_FILTERS id) and its word-start filter text.
  const [filter, setFilter] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [switcher, setSwitcher] = React.useState(false)
  const searchRef = React.useRef(null)
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
  const { snapshot, stale, error, loading, refresh, reload } = useGitSnapshot({ adapter, repos: config.repos, enabled: !!gitVersion && !config.unsupported })
  const actions = useGitActions({ adapter, registered, reload })
  const sync = useGitSync({ adapter, registered, reload })

  if (config.unsupported) return card(`These Git Workspace settings were saved by a newer NexusMD (version ${config.unsupported}). Update NexusMD to use them.`, 'alert')
  if (gitVersion === null) return card('Git not found. Install Git for Windows (git-scm.com) and make sure git is on PATH, then reopen this screen.', 'alert')
  if (gitVersion === undefined) return card('Checking for git…')

  const view = config.view
  const editingGroup = editing?.name ? config.groups.find(g => g.name === editing.name) ?? null : null
  const group = findGroup(config, view.group)
  const scoped = scopeSnapshot(snapshot, group)
  // A group's repositories: whole ones it names, and those holding a worktree or branch it picked.
  const repoCount = g => {
    if (!g) return config.repos.length
    const named = new Set([...g.repos, ...g.branches.map(b => b.repo), ...scopeSnapshot(snapshot, g).worktrees.map(t => t.repo)])
    return config.repos.filter(r => named.has(r.name)).length
  }
  const tabs = [
    { name: ALL_PROJECTS, repos: repoCount(null), editable: false },
    ...config.groups.map(g => ({ name: g.name, repos: repoCount(g), editable: true })),
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

  // Pull all fast-forwards the branches that are behind with nothing local in the way.
  const pullable = scoped.worktrees.filter(t => { const s = branchState(t); return !t.error && s.behind && !s.changed && !s.busy && t.upstream && !t.upstreamGone })
  // The targets are fixed when the dialog opens, so pulled rows stay listed with their result.
  const pullAll = () => sync.open('pull', actionTargets('pull', pullable, null), { mode: 'ff', batch: true })
  const fetchedText = allFetchedText(scoped.worktrees)
  const headStatus = snapshot && stale ? `As of ${readAt(snapshot.takenAt)} · refreshing…` : loading ? 'Refreshing…'
    : fetchedText ?? (snapshot ? `Updated ${readAt(snapshot.takenAt)}` : '')
  const activeTab = tabs.find(t => t.name === (group ? group.name : ALL_PROJECTS))

  const openCommit = (tickedIds = null, messages = {}) => setCommitting({ id: ++commits.current, tickedIds, messages })
  // The commit composer: commits this worktree, then (Commit & push) opens the push preview, publishing
  // a branch with no upstream (or one whose upstream was deleted). Resolves false to keep the draft.
  const commitHere = async (tree, { message, amend, push }) => {
    const r = await actions.commit(tree, message, { amend })
    if (!r?.ok) return false
    if (push) sync.open('push', actionTargets('push', [tree], worktreeId(tree)), tree.upstream && !tree.upstreamGone ? {} : { setUpstream: true })
    return true
  }
  const commitList = committing
    ? commitTargets(scoped.worktrees, view.selected).map(t => (committing.tickedIds ? { ...t, ticked: !t.unavailable && committing.tickedIds.includes(t.id) } : t))
    : []

  const exec = async (tree, argv, alias = null) => {
    const [verb] = argv
    if (!alias && Object.hasOwn(VIA_SYNC, verb) && argv.length === 1) return sync.open(verb, actionTargets(verb, [tree], worktreeId(tree)), VIA_SYNC[verb])
    const line = argv.join(' ')
    // A DotFiles script (g!) runs in PowerShell as typed; anything else is a git command.
    const script = !!alias?.script
    // An alias is judged by what it runs: "undo" may well be reset --hard. A shell alias's own "git" goes too.
    const expanded = alias && !script ? [alias.expansion.replace(/^!\s*(git\s+)?/, ''), ...argv.slice(1)].join(' ') : line
    const shown = script ? line : `git ${line}`
    if ((RISKY.test(line) || RISKY.test(expanded))
      && !window.confirm(`Run "${shown}"${alias && !script ? ` (${alias.expansion})` : ''} in ${tree.path}? This can't be undone from NexusMD.`)) return
    const title = shown
    const head = { text: `$ ${shown}`, tone: 'cmd' }
    if (!(script ? adapter.shellRun : adapter.exec)) { setCmdRun({ title, status: 'failed', lines: [head, { text: "This version of NexusMD can't run git commands. Update the desktop app.", tone: 'bad' }] }); return }
    setCmdRun({ title, status: 'running', lines: [head] })
    try {
      const repo = { name: tree.repo, path: tree.repoRoot }
      const r = script
        ? await adapter.shellRun(repo, tree.path, registered, effectiveDotfiles(getGitConfig()), argv[0], argv.slice(1))
        : await adapter.exec(repo, tree.path, registered, argv)
      const toLines = (s, tone) => (s ? s.replace(/\n$/, '').split('\n').map(text => ({ text, tone })) : [])
      setCmdRun({ title, status: r.code === 0 ? 'done' : 'failed', exitCode: r.code, lines: [head, ...toLines(r.stdout), ...toLines(r.stderr, r.code === 0 ? 'muted' : 'bad')] })
    } catch (e) {
      setCmdRun({ title, status: 'failed', lines: [head, { text: ipcMessage(e), tone: 'bad' }] })
    }
    reload([tree.repo])
  }

  const listHidden = view.list === 'hidden'
  const selectTree = s => { if (s.id !== view.selected && mayLeave()) setView({ selected: s.id }) }
  // From the overview: open a worktree on its Changes, or run the action that moves it forward.
  const openTree = t => { if (mayLeave()) setView({ selected: worktreeId(t), panel: 'changes' }) }
  const overviewAction = (kind, t) => {
    const id = worktreeId(t)
    if (kind === 'resolve' || kind === 'review') openTree(t)
    else if (kind === 'pull') sync.open('pull', actionTargets('pull', [t], id), { mode: 'ff' })
    else if (kind === 'push') sync.open('push', actionTargets('push', [t], id), {})
    else if (kind === 'publish') sync.open('push', actionTargets('push', [t], id), { setUpstream: true })
  }
  return (
    <div className="nx-shell">
    <div className="nx-gw-page">
      <header className="nx-gw-head">
        <div className="nx-gw-head-row">
          <h2 className="nx-gw-title">Git Workspace</h2>
          <GroupTabs tabs={tabs} active={activeTab?.name ?? ALL_PROJECTS}
            onSelect={name => { if (mayLeave()) setView({ group: name, selected: null }) }}
            onNew={() => setEditing({ name: null })} busy={editBusy} />
          {activeTab?.editable && (
            <GroupMenuButton name={activeTab.name} editBusy={editBusy} onEdit={() => setEditing({ name: activeTab.name })}
              onOpen={mode => setMenuFor({ name: activeTab.name, mode })} />
          )}
          <span className="nx-gw-spacer" />
          {headStatus && <span className="nx-gw-status"><span className="nx-gw-dot" data-tone={loading || stale ? 'info' : 'ok'} />{headStatus}</span>}
          <button type="button" className="nx-gw-jumpbtn" disabled={!scoped.worktrees.length} onClick={() => setSwitcher(true)}>
            Jump to branch…<span className="kbd">Ctrl K</span>
          </button>
          <button className="btn sm ghost" title="git fetch --all --prune in every repository" disabled={!scoped.worktrees.length} onClick={() => sync.open('fetch', actionTargets('fetch', scoped.worktrees, null))}>Fetch all</button>
          <button className="btn sm accent" title={pullable.length ? "Fast-forwards every branch that's behind and has no local changes" : 'No branch is behind with nothing local in the way'}
            disabled={!pullable.length} onClick={pullAll}>{`Pull all (${pullable.length})`}</button>
        </div>
        <div className="nx-gw-head-row">
          <BranchSearch ref={searchRef} value={query} onChange={setQuery} />
          <span className="nx-gw-divider" />
          <span className="nx-gw-show">Show</span>
          <FilterChips trees={scoped.worktrees} value={filter} onChange={setFilter} />
          <span className="nx-gw-spacer" />
          <button className="btn sm ghost" aria-pressed={!listHidden} title={listHidden ? 'Show the repository list beside the details' : 'Hide the repository list to give the details the full width'}
            onClick={() => setView({ list: listHidden ? 'shown' : 'hidden' })}>{listHidden ? 'Show repositories' : 'Hide repositories'}</button>
          <button className="btn sm ghost" aria-label="Refresh" title="Read every repository's state again" onClick={refresh}>Refresh</button>
        </div>
      </header>

      <div className="nx-gw-alerts">
        {error && card(error, 'alert')}
        {!config.repos.length && card(roots.length
          ? `No repositories registered yet. Pick them in Settings → Desktop → Git Workspace, which lists the repositories found in ${roots.join('; ')}.`
          : 'No repositories registered yet. Add them in Settings → Desktop → Git Workspace.')}
      </div>

      <div className="nx-gw-body" data-list={listHidden ? 'hidden' : 'shown'}>
        {!listHidden && (
          <nav aria-label="Branches" className="nx-gw-aside">
            <BranchList repos={config.repos} scoped={scoped} query={query} filter={filter} onClearFilters={() => { setQuery(''); setFilter('all') }} errors={snapshot?.errors || []} collapsed={view.collapsed}
              onToggleRepo={name => setView({ collapsed: view.collapsed.includes(name) ? view.collapsed.filter(n => n !== name) : [...view.collapsed, name] })}
              onSetCollapsed={collapsed => setView({ collapsed })}
              selected={view.selected} onSelect={selectTree} />
          </nav>
        )}
        <aside aria-label="Details" className="nx-gw-main">
          {selectedTree
            ? (
              <WorktreePanel ref={panelRef} adapter={adapter} repo={{ name: selectedTree.repo, path: selectedTree.repoRoot }} registered={registered}
                version={snapshot?.takenAt} tree={selectedTree} selected={selectedIds} focusId={focusId}
                onSelectionChange={ids => setSelections(s => ({ ...s, [treeKey]: ids }))}
                onFocus={id => setFocus(f => ({ ...f, [treeKey]: id }))}
                onAction={action => actions.openReview(action, selectedTree, selectedIds)} onWrite={(action, ids) => actions.write(action, selectedTree, ids)}
                onCommit={draft => commitHere(selectedTree, draft)} onResolve={(change, take, onResolved) => actions.resolve(selectedTree, change, take, onResolved)}
                onHunk={(change, index, stamp, after) => actions.hunk(selectedTree, change, index, stamp, after)}
                busy={!!actions.busy[selectedTree.path] || cmdRun?.status === 'running'} status={actions.status[selectedTree.path] ?? null}
                split={view.split} onSplit={split => setView({ split })}
                panel={view.panel} onPanel={panel => setView({ panel })}
                onSync={(kind, options) => sync.open(kind, actionTargets(kind, [selectedTree], treeKey), options)}
                onExec={exec} onSaved={() => reload([selectedTree.repo])}
                onOverview={() => { if (mayLeave()) setView({ selected: null }) }} onSwitch={() => setSwitcher(true)} />
            )
            : selectedBranch
            ? (
              <div style={{ padding: 16 }}>
                <BranchHistory adapter={adapter} branch={selectedBranch} repos={config.repos} worktrees={snapshot?.worktrees ?? []}
                  registered={registered} split={view.split} onSplit={split => setView({ split })} />
              </div>
            )
            : snapshot && (
              <AttentionOverview trees={scoped.worktrees} repoCount={new Set(scoped.worktrees.map(t => t.repo)).size}
                onOpen={openTree} onAction={overviewAction} onPullAll={pullAll}
                onCommitAcross={() => openCommit(commitTargets(scoped.worktrees, null).filter(t => !t.unavailable).map(t => t.id))} />
            )}
        </aside>
      </div>

      {switcher && (
        <BranchSwitcher trees={scoped.worktrees} selected={view.selected} onClose={() => setSwitcher(false)}
          onOpen={t => { setSwitcher(false); selectTree({ kind: 'worktree', id: worktreeId(t) }) }} />
      )}

      <ActivityDrawer sync={sync} />
      <ActionDialog sync={sync} adapter={adapter} registered={registered} />
      {menuFor && (
        <GroupMenu key={`${menuFor.name}|${menuFor.mode}`} name={menuFor.name} mode={menuFor.mode} onClose={() => setMenuFor(null)}
          onRename={value => {
            try {
              const cfg = getGitConfig()
              const next = renameGroup(cfg, menuFor.name, value)
              const renamed = next.groups.find(g => g.name.toLowerCase() === value.trim().toLowerCase())
              setGitConfig({ repos: next.repos, groups: next.groups,
                view: cfg.view.group === menuFor.name ? { ...cfg.view, group: renamed ? renamed.name : value.trim() } : cfg.view })
              return null
            } catch (e) { return e.message }
          }}
          onDuplicate={tryName((cfg, value) => duplicateGroup(cfg, menuFor.name, value))}
          onDelete={() => {
            if (view.group === menuFor.name && !mayLeave()) return
            save(deleteGroup(getGitConfig(), menuFor.name))
            if (view.group === menuFor.name) setView({ group: ALL_PROJECTS, selected: null })
          }} />
      )}
      <GroupEditor open={!!editing} config={config} snapshot={snapshot} existing={editingGroup}
        onClose={() => setEditing(null)}
        onDelete={editingGroup ? () => {
          if (view.group === editingGroup.name && !mayLeave()) return
          save(deleteGroup(getGitConfig(), editingGroup.name))
          if (view.group === editingGroup.name) setView({ group: ALL_PROJECTS, selected: null })
          setEditing(null)
        } : null}
        onSaved={(next, saved) => {
          // Saving shows the group with nothing selected; declining keeps the dialog open and nothing saved.
          if (!mayLeave()) return
          // Groups never change the registered list, so the snapshot isn't reloaded for the save itself.
          save(next)
          setView({ group: saved.name, selected: null })
          setEditing(null)
          refresh()
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
