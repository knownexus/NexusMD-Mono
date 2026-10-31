// app-update.js — in-app updates from GitHub releases, for installs that did not come from Google
// Play (see AppUpdatePlugin.java). The release workflow tags Android builds `android-v<version>` and
// attaches the signed APK; this finds the newest one and compares it with the installed version.
import { registerPlugin, Capacitor } from '@capacitor/core';

export const REPO = 'knownexus/NexusMD-Mono';
export const TAG_PREFIX = 'android-v';
export const updatePlugin = registerPlugin('AppUpdate');

const parts = (v) => String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);

// 1 when a is newer than b, -1 when older, 0 when equal.
export function compareVersions(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// The newest published Android release that carries an APK: { version, url, notes, name } or null.
export function newestAndroidRelease(releases) {
  let best = null;
  for (const r of releases || []) {
    if (r.draft || r.prerelease || !String(r.tag_name || '').startsWith(TAG_PREFIX)) continue;
    const asset = (r.assets || []).find(a => /\.apk$/i.test(a.name));
    if (!asset) continue;
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, url: asset.browser_download_url, notes: r.body || '', name: asset.name };
    }
  }
  return best;
}

export const updatesSupported = () => Capacitor.isNativePlatform();

// -> { supported: false } | { supported: true, fromPlay, current, latest: release|null, available }
export async function checkForUpdate({ plugin = updatePlugin, fetchImpl = fetch, supported = updatesSupported } = {}) {
  if (!supported()) return { supported: false };
  const info = await plugin.getInfo();
  // Play updates a Play install itself, and a release APK (different signature) could not replace it.
  if (info.fromPlay) return { supported: true, fromPlay: true, current: info.versionName, latest: null, available: false };
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const latest = newestAndroidRelease(await res.json());
  return {
    supported: true, fromPlay: false, current: info.versionName, latest,
    available: !!latest && compareVersions(latest.version, info.versionName) > 0,
  };
}

export const installUpdate = (release, { plugin = updatePlugin } = {}) => plugin.downloadAndInstall({ url: release.url });
