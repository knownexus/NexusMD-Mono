import React from 'react'
import { Icon, VsCard, VsRow, BundlePasswordModal, toast } from '@nexusmd/ui'
import { appPrefsAdapter } from './adapters/appPrefs.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { pickerAdapter } from './adapters/picker.js'
import { registry } from './shell/registry.js'
import {
  collectSettings, applySettings, encodeSettings, decodeSettings, settingsFilename, SETTINGS_EXT,
} from './settings-file.js'

const sources = () => ({
  storage: localStorage, secure: secureStorageAdapter, prefs: appPrefsAdapter,
  installedApps: registry.installedApps.map(a => a.id),
})

// Save every setting on this machine (tokens, repos, database connections, ...) to one
// password-encrypted file, or load one back. See settings-file.js for what goes in it.
export function SettingsFileCard() {
  const [mode, setMode] = React.useState(null)   // 'export' | 'import'
  const [pendingText, setPendingText] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  const startImport = async () => {
    const picked = await pickerAdapter.pickFile({ ext: SETTINGS_EXT })
    if (!picked?.text) return
    setPendingText(picked.text)
    setMode('import')
  }

  const onPassword = async (password) => {
    setBusy(true)
    try {
      if (mode === 'export') {
        const text = await encodeSettings(await collectSettings(sources()), password)
        await pickerAdapter.saveFile(settingsFilename(), text)
        toast?.('Settings file saved.', 'success')
      } else {
        const payload = await decodeSettings(pendingText, password)
        const { keys, secrets, disabledApps } = await applySettings(payload, sources())
        const running = registry.apps.map(a => a.id)
        const appsChange = disabledApps && registry.installedApps.some(a => disabledApps.includes(a.id) === running.includes(a.id))
        if (appsChange) {
          // Switching apps on or off takes a restart, which also reloads everything else.
          toast?.(`Imported ${keys} settings and ${secrets} secrets. Restarting to apply the apps…`, 'success')
          setTimeout(() => appPrefsAdapter.restartApp(disabledApps), 700)
        } else {
          toast?.(`Imported ${keys} settings and ${secrets} secrets. Reloading…`, 'success')
          setTimeout(() => window.location.reload(), 700)
        }
      }
    } catch (e) {
      toast?.(e?.message || 'Something went wrong.', 'error')
    } finally { setBusy(false); setMode(null); setPendingText(null) }
  }

  return (
    <VsCard title="Settings file" icon="lock">
      <VsRow title="Export all settings"
        desc={<>Every profile with its tokens, repos, database connections and dev environment, plus app and desktop preferences, in one password-encrypted <code>{SETTINGS_EXT}</code> file</>}>
        <button className="btn sm" disabled={busy} onClick={() => setMode('export')}>
          <Icon name="send" size={12} /> Export…
        </button>
      </VsRow>
      <VsRow title="Import settings" desc="Load a settings file. It overwrites the settings it contains and keeps everything else, then reloads">
        <button className="btn sm ghost" disabled={busy} onClick={startImport}>
          <Icon name="inbox" size={12} /> Import…
        </button>
      </VsRow>
      <BundlePasswordModal
        open={mode != null}
        confirm={mode === 'export'}
        onClose={() => { setMode(null); setPendingText(null) }}
        onSubmit={onPassword}
      />
    </VsCard>
  )
}
