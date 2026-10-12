import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'
import { normaliseCatalog, isCompatibleCatalog } from '@nexusmd/core'
import { getDevenvConfig, setDevenvConfig } from './devenv-config.js'
import { devenvAdapter } from './adapters/devenv.js'
import { pickerAdapter } from './adapters/picker.js'

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
}

export function DevenvSettingsCard({ adapter = devenvAdapter, picker = pickerAdapter }) {
  const [cfg, setCfg] = React.useState(getDevenvConfig)
  const [check, setCheck] = React.useState(null)

  if (!adapter.isAvailable()) return null

  const update = patch => setCfg(setDevenvConfig(patch))
  const browse = async key => {
    const dir = await picker.pickDirectory()
    if (dir) update({ [key]: dir })
  }
  const runCheck = async () => {
    setCheck({ ok: null, text: 'Checking…' })
    try {
      const catalog = normaliseCatalog(await adapter.catalog(cfg))
      if (!isCompatibleCatalog(catalog)) {
        setCheck({ ok: false, text: `This devenv speaks protocol ${catalog.protocol}; NexusMD needs 1 - update devenv.` })
        return
      }
      const note = catalog.profileError ? ` - profile problem: ${catalog.profileError}` : ''
      setCheck({ ok: !catalog.profileError, text: `devenv OK - ${catalog.commands.length} commands${note}` })
    } catch (e) {
      setCheck({ ok: false, text: e.message })
    }
  }

  const folderRow = (key, title, desc, placeholder) => (
    <VsRow title={title} desc={desc}>
      <div style={{ display: 'flex', gap: 8, minWidth: 360 }}>
        <input aria-label={title} value={cfg[key]} placeholder={placeholder} style={inputStyle}
          onChange={e => update({ [key]: e.target.value })} />
        <button className="btn sm ghost" onClick={() => browse(key)}>Browse…</button>
      </div>
    </VsRow>
  )

  return (
    <VsCard title="Dev Environment" icon="build">
      {folderRow('root', 'devenv folder', 'The folder that contains devenv.ps1', 'C:\\repos\\dev-environment')}
      <VsRow title="PowerShell" desc="pwsh 7 - a name on PATH or a full path to pwsh.exe">
        <input aria-label="PowerShell" value={cfg.pwsh} style={{ ...inputStyle, minWidth: 360 }}
          onChange={e => update({ pwsh: e.target.value })} />
      </VsRow>
      {folderRow('profile', 'Profile folder', 'Optional - empty uses devenv\'s own profile/ folder (DEVENV_PROFILE)', '(devenv folder)\\profile')}
      <VsRow title="Check" desc={check ? check.text : 'Asks devenv for its command list'}>
        <button className="btn sm" onClick={runCheck}>Check</button>
      </VsRow>
    </VsCard>
  )
}
