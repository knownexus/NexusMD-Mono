// profile-keys.js — localStorage key namespacing for profiles.
// No React, no Capacitor — safe to import from any file.

export function getProfileKey(key) {
  try {
    const id = localStorage.getItem('helm.activeProfileId');
    if (!id) return key;
    const suffix = key.startsWith('helm.') ? key.slice(5) : key;
    return `helm.p.${id}.${suffix}`;
  } catch (_) { return key; }
}

