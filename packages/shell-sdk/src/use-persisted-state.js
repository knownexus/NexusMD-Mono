import React from 'react'
import { getProfileKey } from './profile-keys.js'

// useState that survives restarts: the value lives in localStorage under the active profile's
// copy of `key`, so each profile keeps its own.
export function usePersistedState(key, initial) {
  const sk = getProfileKey(key)
  const [value, setValue] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(sk)
      return raw === null ? initial : JSON.parse(raw)
    } catch { return initial }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem(sk, JSON.stringify(value)) } catch { /* ignore */ }
  }, [sk, value])
  return [value, setValue]
}
