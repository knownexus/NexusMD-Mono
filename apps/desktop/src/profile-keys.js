// profile-keys.js — thin platform binding over @nexusmd/core's makeProfileKeys.
// Desktop uses the canonical `nexusmd.` namespace; the key logic lives in core.
import { makeProfileKeys } from '@nexusmd/core'

export const { getProfileKey, getActiveProfileId } = makeProfileKeys({
  namespace: 'nexusmd',
  getActiveId: () => {
    try { return localStorage.getItem('nexusmd.activeProfileId') } catch { return '' }
  },
})
