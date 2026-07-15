// api-client-context.jsx — the seam for the API client module's adapters
// (file, scriptRunner, secureStorage, apiHttp). Deliberately separate from
// data-context.jsx: that context feeds the polling ADO data cycle, while this
// module is action-oriented (the view calls core's api-client functions on
// demand). Each app wraps its api-client view once with <ApiClientProvider>,
// passing the same adapters object it gave initCore().

import React from 'react'

const DEFAULTS = { adapters: {} }

const ApiClientContext = React.createContext(DEFAULTS)

export function ApiClientProvider({ adapters, children }) {
  const value = React.useMemo(() => ({ adapters: adapters || {} }), [adapters])
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>
}

/** `available` is false when scriptRunner/file aren't wired (e.g. web/app today) — the view shows a fallback instead of crashing on undefined adapter calls. */
export function useApiClient() {
  const { adapters } = React.useContext(ApiClientContext)
  const available = !!(adapters.file && adapters.scriptRunner)
  return { adapters, available }
}
