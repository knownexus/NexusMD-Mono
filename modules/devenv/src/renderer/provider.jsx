import React from 'react'
import { DevenvRunProvider } from './devenv-run-context.jsx'

// Wraps the whole shell, above every screen, so a run and its prompts outlive leaving the Dev
// Environment screen. `notify` raises an OS notification when a run is waiting for an answer.
export function DevenvProvider({ adapters, notify, children }) {
  return (
    <DevenvRunProvider adapter={adapters.devenv}
      notify={(title, body) => notify(title, body, { tag: 'devenv-prompt' })}>
      {children}
    </DevenvRunProvider>
  )
}
