const ACTIVE_ID_KEY = 'nexusmd.activeProfileId';

export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_ID_KEY) || '';
}

export function getProfileKey(key) {
  const id = getActiveProfileId();
  return id ? `nexusmd.p.${id}.${key}` : `nexusmd.${key}`;
}
