// applied-policy.js — what a window does when a pull from the account changed local data (see AccountGate). Reloading
// the whole app is the safe answer, and the old one for every change; most changes do not need it:
//   'none'    only profiles that are not the one in use changed: nothing on screen shows them (switching profile reloads anyway)
//   'live'    only settings the open screens can read again when told (see isLiveSafe in the key registry): they are told
//   'reload'  anything else: something that belongs to no profile (the profiles list, this device's prefs), data of the profile in
//             use that is read when the app starts (documents, tokens, ...), or a pull that does not say what it wrote
// `info` is what the sync's onApplied gives: { applied, items: [{ id, profileId }] | null, global }.

// The event name each live item answers to on `nexusmd:sync-applied` (detail.collId): the phone already re-reads tweaks on 'tweaks'.
function collOf(id) {
  if (/tweaks#/.test(id)) return 'tweaks'
  if (/work\.screens\.off$/.test(id)) return 'work-screens'
  return 'settings-collapsed'
}

export function appliedAction(info, { active = null, isLiveSafe = () => false } = {}) {
  const items = info && Array.isArray(info.items) ? info.items : null
  if (!items || !items.length || !active) return { type: 'reload' }
  if (items.some(i => !i || !i.profileId)) return { type: 'reload' }
  const mine = items.filter(i => i.profileId === active)
  if (!mine.length) return { type: 'none' }
  if (!mine.every(i => isLiveSafe(i.id))) return { type: 'reload' }
  return { type: 'live', collIds: [...new Set(mine.map(i => collOf(i.id)))] }
}
