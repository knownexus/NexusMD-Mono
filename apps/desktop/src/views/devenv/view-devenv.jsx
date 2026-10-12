import React from 'react'
import { notificationAdapter } from '@nexusmd/web-adapters'
import { pickerAdapter } from '../../adapters/picker.js'
import { CommandsView } from './commands-view.jsx'

// Phase 1 has one tab; Status, Start, Builds, Logs, Tests, Database, Emulator, Mac and
// Profile join it in later phases (docs/superpowers/specs/2026-10-08-devenv-module-design.md).
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  if (!adapter?.isAvailable()) return <div style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Dev Environment</h2>
      <CommandsView adapter={adapter} picker={pickerAdapter}
        notify={(title, body) => notificationAdapter.send(title, body, { tag: 'devenv-prompt' })} />
    </div>
  )
}
