// github-mode.jsx — the Local / GitHub switch of Git Workspace. The page owns the mode (it may refuse
// to leave unsaved work); it publishes it here, and the switch is drawn in the shell's top bar beside
// the screen's title. A shell too old to tell its top bar slots which view is showing never renders
// the top bar switch, so the page keeps one of its own.
import React from 'react'

const blank = { available: false, onGithub: false, request: () => {} }

function createStore() {
  let state = blank
  let topbarShown = false
  const listeners = new Set()
  const emit = () => listeners.forEach(fn => fn())
  return {
    get: () => state,
    topbarShown: () => topbarShown,
    publish(next) { state = next; emit() },
    markTopbar() { if (!topbarShown) { topbarShown = true; emit() } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    reset() { state = blank; topbarShown = false; emit() },
  }
}

export const githubMode = createStore()

const useMode = () => React.useSyncExternalStore(githubMode.subscribe, githubMode.get)

/** Whether the top bar draws the switch (so the page doesn't). */
export function useTopbarShowsMode() {
  return React.useSyncExternalStore(githubMode.subscribe, githubMode.topbarShown)
}

export function ModeSwitch({ onGithub, request }) {
  return (
    <div role="tablist" aria-label="Git Workspace view" className="nx-gw-seg nx-gw-mode">
      <button type="button" role="tab" aria-selected={!onGithub} onClick={() => request('local')}>Local</button>
      <button type="button" role="tab" aria-selected={onGithub} onClick={() => request('github')}>GitHub</button>
    </div>
  )
}

/** The app's top bar slot: the switch, on Git Workspace's own screen, once GitHub is connected. */
export function GitTopbar({ view }) {
  const mode = useMode()
  const named = view !== undefined
  React.useEffect(() => { if (named) githubMode.markTopbar() }, [named])
  if (view !== 'git' || !mode.available) return null
  return <ModeSwitch onGithub={mode.onGithub} request={mode.request} />
}
