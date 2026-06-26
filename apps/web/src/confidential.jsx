
// confidential.jsx
// AES-GCM password-protected planner section helpers.
// Ported from ManagementDashboard.App/src/planner/view-planner.jsx.

import { getProfileKey } from './profile-keys.js';
import { nexusMDPushPref } from './components.jsx';

export async function hashPassword(password) {
  try {
    const data = new TextEncoder().encode(password + ' helm-planner');
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {
    return btoa(unescape(encodeURIComponent(password)));
  }
}

export async function encryptConfidentialForServer(cfg, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(cfg));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  };
}

export async function decryptConfidentialFromServer(encrypted, passwordHash) {
  const keyBytes = new Uint8Array(passwordHash.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = new Uint8Array(encrypted.iv.match(/.{2}/g).map(h => parseInt(h, 16)));
  const ct = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function loadConfidentialConfig() {
  try {
    return JSON.parse(localStorage.getItem(getProfileKey('nexusmd.planner.confidential')) || '{"sections":[],"hash":null}');
  } catch {
    return { sections: [], hash: null };
  }
}

export function saveConfidentialConfig(cfg) {
  try {
    localStorage.setItem(getProfileKey('nexusmd.planner.confidential'), JSON.stringify(cfg));
  } catch {}
  if (cfg.hash) {
    (async () => {
      try {
        const encrypted = await encryptConfidentialForServer(cfg, cfg.hash);
        nexusMDPushPref('nexusmd.planner.confidential', JSON.stringify(encrypted));
      } catch (_) {}
    })();
  }
}
