export function getProfileKey(key) {
  try {
    const id = localStorage.getItem('nexusmd.activeProfileId');
    if (!id) return key;
    const suffix = key.startsWith('nexusmd.') ? key.slice(5) : key;
    return `nexusmd.p.${id}.${suffix}`;
  } catch (_) { return key; }
}
