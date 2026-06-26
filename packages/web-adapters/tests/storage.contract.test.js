import { runStorageAdapterContract } from '@nexusmd/core/test-contracts'
import { localStorageAdapter } from '../src/index.js'

// The real browser localStorageAdapter must satisfy core's IStorageAdapter contract.
// jsdom provides window.localStorage.
runStorageAdapterContract('localStorageAdapter (jsdom)', () => {
  localStorage.clear()
  return localStorageAdapter
})
