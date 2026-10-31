// nav-pref.js — the saved navigation layout (per profile), as a hook: every reader updates when it
// is changed, wherever it was changed from.
import React from 'react';
import { getProfileKey } from './profile-keys.js';
import { parsePref } from './nav-config.js';

const KEY = () => getProfileKey('helm.nav');
const EVENT = 'helm:nav';

export const readNavPref = () => { try { return parsePref(localStorage.getItem(KEY())); } catch { return null; } };
export function writeNavPref(pref) {
  try { if (pref) localStorage.setItem(KEY(), JSON.stringify(pref)); else localStorage.removeItem(KEY()); } catch { /* storage full */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useNavPref() {
  const [pref, setPref] = React.useState(readNavPref);
  React.useEffect(() => {
    const on = () => setPref(readNavPref());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [pref, writeNavPref];
}
