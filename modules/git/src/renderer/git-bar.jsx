// git-bar.jsx — the controls on the right of Git Workspace's single top bar: when the data was fetched, Jump to
// branch, Fetch all, Pull all, Refresh and the branch list's show/hide. The page owns them (they act on its
// state) and publishes them here; the shell's top bar draws them beside the title and the Local / GitHub
// switch. An older shell's top bar can't, so the page draws the same controls itself.
import React from 'react'
import { Icon } from '@nexusmd/ui'

const noop = () => {}

export const BLANK_BAR = Object.freeze({
  active: false, onGithub: false, repoNote: null, status: null,
  canJump: false, onJump: noop, fetchDisabled: true, onFetchAll: noop,
  pullCount: 0, onPullAll: noop, onRefresh: noop, listHidden: false, onToggleList: noop,
})

const same = (a, b) => { const k = Object.keys(a); return k.length === Object.keys(b).length && k.every(key => Object.is(a[key], b[key])) }

function createBarStore() {
  let state = BLANK_BAR
  const listeners = new Set()
  return {
    get: () => state,
    publish(next) { if (same(state, next)) return; state = next; listeners.forEach(fn => fn()) },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    reset() { this.publish(BLANK_BAR) },
  }
}

export const gitBar = createBarStore()

export const useGitBar = () => React.useSyncExternalStore(gitBar.subscribe, gitBar.get)

/** The controls themselves, from a published (or the page's own) `bar` state. */
export function GitTopbarControls({ bar }) {
  const { status, pullCount } = bar
  return (
    <>
      {bar.repoNote && <span className="nx-gw-head-note">{bar.repoNote}</span>}
      <span className="nx-gw-spacer" />
      {!bar.onGithub && (
        <>
          {status && <span className="nx-gw-status"><span className="nx-gw-dot" data-tone={status.tone} />{status.text}</span>}
          <button type="button" className="nx-gw-jumpbtn" disabled={!bar.canJump} title={bar.canJump ? undefined : 'No branches to jump to'} onClick={bar.onJump}>
            Jump to branch…<span className="kbd">Ctrl K</span>
          </button>
          <button type="button" className="btn sm nx-gw-bar-btn" disabled={bar.fetchDisabled}
            title={bar.fetchDisabled ? 'No repositories to fetch' : 'git fetch --all --prune in every repository'} onClick={bar.onFetchAll}>Fetch all</button>
          <button type="button" className="btn sm ghost nx-gw-bar-btn" data-none={pullCount ? undefined : ''} disabled={!pullCount}
            title={pullCount ? "Fast-forwards every branch that's behind and has no local changes" : 'No branch is behind with nothing local in the way'}
            onClick={bar.onPullAll}>{`Pull all (${pullCount})`}</button>
          <button type="button" className="nx-gw-icon-btn nx-gw-bar-icon" aria-label="Refresh" title="Read every repository's state again" onClick={bar.onRefresh}>
            <Icon name="refresh" size={14} />
          </button>
          <button type="button" className="nx-gw-icon-btn nx-gw-bar-icon" aria-pressed={!bar.listHidden}
            aria-label={bar.listHidden ? 'Show repositories' : 'Hide repositories'}
            title={bar.listHidden ? 'Show the repository list beside the details' : 'Hide the repository list to give the details the full width'}
            onClick={bar.onToggleList}>
            <Icon name="list" size={14} />
          </button>
        </>
      )}
    </>
  )
}
