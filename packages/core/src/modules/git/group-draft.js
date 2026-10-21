// The group editor's model, ported from gws GroupDraft: whole repos, worktree paths and
// branches of registered repositories can be mixed; saving is all-or-nothing. Repositories are
// registered in Settings only, so saving a group never changes the registered list.

import { worktreeId, worktreeName, branchLabel } from './parse.js'
import { groupNameError } from './groups.js'

const memberId = (kind, repo, value) => `${kind}\x00${repo}\x00${value}`
const member = (kind, repo, value, label) => ({ kind, repo, value, label, id: memberId(kind, repo, value) })
const isEntry = m => m.kind === 'worktree' || m.kind === 'branch'

export class GroupDraft {
  constructor(config, snapshot, existing = null) {
    this.members = []
    this.checked = new Set()
    this.branchesShown = new Set()
    const worktrees = snapshot?.worktrees || []
    const branches = snapshot?.branches || []
    for (const repo of config.repos) {
      this.members.push(member('repo', repo.name, repo.name, repo.name))
      for (const t of worktrees.filter(t => t.repo === repo.name)) {
        this.members.push(member('worktree', repo.name, worktreeId(t), `${worktreeName(t)} → ${branchLabel(t)}${t.error ? ' (unavailable)' : ''}`))
      }
      for (const b of branches.filter(b => b.repo === repo.name)) this.members.push(member('branch', repo.name, b.ref, `Branch · ${b.name}`))
    }
    if (!existing) return
    // Missing entries stay selected so a temporarily unavailable disk or ref doesn't shrink the group.
    for (const name of existing.repos) this.#selectOrAdd(member('repo', name, name, `${name} (unavailable)`))
    for (const path of existing.worktrees) {
      this.#selectOrAdd(this.members.find(m => m.kind === 'worktree' && m.value === path) ?? member('worktree', '(unavailable)', path, `${path} (unavailable)`))
    }
    for (const b of existing.branches) this.#selectOrAdd(member('branch', b.repo, b.ref, `Branch · ${b.ref.replace(/^refs\/heads\//, '')} (unavailable)`))
  }

  #selectOrAdd(m) {
    if (!this.members.some(x => x.id === m.id)) this.members.push(m)
    this.checked.add(m.id)
  }

  inherited(m) {
    return isEntry(m) && this.checked.has(memberId('repo', m.repo, m.repo))
  }

  toggle(m) {
    if (this.inherited(m)) throw new Error('This is included by the whole repo. Switch the repo to individual entries to choose it.')
    if (!this.checked.delete(m.id)) this.checked.add(m.id)
  }

  state(repo) {
    if (this.checked.has(memberId('repo', repo, repo))) return 'whole'
    return this.members.some(m => m.repo === repo && isEntry(m) && this.checked.has(m.id)) ? 'some' : 'none'
  }

  toggleWhole(repo) {
    const head = this.members.find(m => m.kind === 'repo' && m.repo === repo)
    if (!head) return
    const children = this.members.filter(m => m.repo === repo && isEntry(m))
    if (this.checked.delete(head.id)) {
      for (const t of children.filter(c => c.kind === 'worktree')) this.checked.add(t.id)
    } else {
      for (const c of children) this.checked.delete(c.id)
      this.checked.add(head.id)
    }
  }

  rows(search = '', folded = new Set()) {
    const q = search.trim().toLowerCase()
    const out = []
    for (const head of this.members.filter(m => m.kind === 'repo')) {
      const children = this.members.filter(m => m.repo === head.repo && (m.kind === 'worktree' || (m.kind === 'branch' && (this.branchesShown.has(head.repo) || this.checked.has(m.id)))))
      const match = m => !q || `${head.label} ${m.label}`.toLowerCase().includes(q)
      if (!match(head) && !children.some(match)) continue
      out.push(head)
      if (!folded.has(head.repo)) out.push(...children.filter(match))
    }
    // Selected entries whose repository is no longer registered stay visible so they can be unticked.
    const registered = new Set(this.members.filter(m => m.kind === 'repo').map(m => m.repo))
    out.push(...this.members.filter(m => isEntry(m) && this.checked.has(m.id) && !registered.has(m.repo)))
    return out
  }

  /** Validates everything first, then returns the new config and group; inputs are never mutated. */
  commit(config, name, existing) {
    const error = groupNameError(config, name, existing?.name ?? null)
    if (error) throw new Error(error)
    const groupName = String(name).trim()
    const ticked = this.members.filter(m => this.checked.has(m.id))
    const repos = [...new Set(ticked.filter(m => m.kind === 'repo').map(m => m.value))]
    const worktrees = [...new Set(ticked.filter(m => m.kind === 'worktree').map(m => m.value))]
    const branches = ticked.filter(m => m.kind === 'branch').map(m => ({ repo: m.repo, ref: m.value }))
    if (!repos.length && !worktrees.length && !branches.length) throw new Error('Select at least one repository, worktree or branch.')
    const group = { name: groupName, repos, worktrees, branches }
    const replacing = existing && config.groups.includes(existing)
    const groups = replacing ? config.groups.map(g => g === existing ? group : g) : [...config.groups, group]
    return { config: { ...config, groups }, group }
  }
}
