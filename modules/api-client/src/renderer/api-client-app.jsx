import React from 'react'
import { ApiClientProvider, ApiClientView } from '@nexusmd/ui'

// The API Client screen. ApiClientProvider needs the adapter set (scriptRunner and apiHttp are
// this app's own).
export function ApiClientApp({ adapters }) {
  return (
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )
}
