// Renames all helm.* and helm_* localStorage keys to nexusmd.* / nexusmd_*
// so existing user data is preserved after the NexusMD rebrand.
(function migrateHelmKeysToNexusMD() {
  if (localStorage.getItem('nexusmd.migration.v1')) return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  keys.forEach(key => {
    let newKey = null;
    if (key && key.startsWith('helm.'))  newKey = 'nexusmd.' + key.slice(5);
    if (key && key.startsWith('helm_'))  newKey = 'nexusmd_' + key.slice(5);
    if (newKey) {
      const v = localStorage.getItem(key);
      if (v !== null) localStorage.setItem(newKey, v);
      localStorage.removeItem(key);
    }
  });
  localStorage.setItem('nexusmd.migration.v1', '1');
})();

// One-time fix for the historical slice(5) bug in the old local getProfileKey:
// `nexusmd.`-prefixed keys (8 chars) were stored with a leaked "md." segment, e.g.
// nexusmd.p.{id}.md.profile.photo. @nexusmd/core's makeProfileKeys strips the full
// prefix, so rewrite any existing buggy keys to their correct names. The only keys
// that can have a ".md." segment immediately after the profile id came from this bug
// (no logical key is bare "md.*"), so this rewrite is deterministic and safe.
(function fixProfileKeySlice5Bug() {
  if (localStorage.getItem('nexusmd.migration.profileKeyFix.v1')) return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  keys.forEach(key => {
    const m = key && key.match(/^(nexusmd\.p\.[^.]+\.)md\.(.+)$/);
    if (!m) return;
    const correct = m[1] + m[2];
    const v = localStorage.getItem(key);
    if (v !== null && localStorage.getItem(correct) === null) {
      localStorage.setItem(correct, v);
    }
    localStorage.removeItem(key);
  });
  localStorage.setItem('nexusmd.migration.profileKeyFix.v1', '1');
})();

export async function runProfileMigration() {
  try {
    const profiles = JSON.parse(localStorage.getItem('nexusmd.profiles') || '[]');
    if (profiles.length > 0) return; // already migrated

    const org = localStorage.getItem('nexusmd.android.org');
    const pat = localStorage.getItem('nexusmd.android.pat');
    if (!org || !pat) return; // no legacy config to migrate

    const projectsRaw = localStorage.getItem('nexusmd.android.projects');
    const projects = projectsRaw ? JSON.parse(projectsRaw) : [];

    const config = JSON.stringify({ org, pat, projects });
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: org, initials: org.slice(0, 2).toUpperCase(), color: '#9a7e22', type: 'ado', config }),
    });
    if (!res.ok) return;

    const profile = await res.json();
    const actRes = await fetch(`/api/profiles/${profile.id}/activate`, { method: 'POST' });
    if (!actRes.ok) return;

    const id = profile.id;
    const keysToCopy = [
      ['nexusmd.android.org',         `nexusmd.p.${id}.android.org`],
      ['nexusmd.android.pat',         `nexusmd.p.${id}.android.pat`],
      ['nexusmd.android.projects',    `nexusmd.p.${id}.android.projects`],
      ['nexusmd.android.refreshSecs', `nexusmd.p.${id}.android.refreshSecs`],
      ['nexusmd.tweaks',              `nexusmd.p.${id}.tweaks`],
      ['nexusmd.planner',             `nexusmd.p.${id}.planner`],
    ];
    keysToCopy.forEach(([from, to]) => {
      const v = localStorage.getItem(from);
      if (v !== null) localStorage.setItem(to, v);
    });

    localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: profile.id, name: profile.name, initials: profile.initials, color: profile.color, type: 'ado' }]));
    localStorage.setItem('nexusmd.activeProfileId', profile.id);
  } catch (_) {}
}
