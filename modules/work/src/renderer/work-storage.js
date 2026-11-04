// work-storage.js — the storage adapter Work's loaders use: localStorage, with the ADO data cache
// and the providers' load status kept under the active profile (they were global, so one
// profile's data showed in another).
import { profileCacheStorage } from '@nexusmd/core'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { getProfileKey } from '@nexusmd/shell-sdk'

export const workStorage = profileCacheStorage(localStorageAdapter, getProfileKey)
