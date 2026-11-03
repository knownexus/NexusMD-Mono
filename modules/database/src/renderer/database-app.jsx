import React from 'react'
import { ViewDbManager } from '@nexusmd/ui'
import { CodeEditor } from '@nexusmd/editor-kit/code-editor.jsx'
import '@nexusmd/editor-kit/devenv-git.css'
import { listSavedConnections, getConnectionSecret, saveConnection } from './db-manager-config.js'

// The Query tab's editor: the shared CodeMirror editor with SQL highlighting.
function SqlEditor({ value, onChange, ariaLabel }) {
  return <CodeEditor value={value} onChange={onChange} ariaLabel={ariaLabel} language="sql" />
}

// The Database screen, with this profile's saved connections. A connection saved from its
// connect dialog goes in the same list as Settings (password in secure storage); the list is
// read again afterwards so the new one shows straight away.
export function DatabaseApp({ adapters, host }) {
  const secureStorage = host.adapters.secureStorage
  const [, refresh] = React.useReducer(n => n + 1, 0)
  const onSaveConnection = React.useCallback(async (meta, secret) => {
    const id = await saveConnection(secureStorage, meta, secret)
    refresh()
    return id
  }, [secureStorage])
  return (
    <ViewDbManager
      adapters={adapters}
      savedConnections={listSavedConnections()}
      onResolveSecret={id => getConnectionSecret(secureStorage, id)}
      onSaveConnection={onSaveConnection}
      SqlEditor={SqlEditor}
    />
  )
}
