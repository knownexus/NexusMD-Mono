// profile-migration.js — one-time migration from flat helm.* keys to profile-scoped keys.
// Runs on every app boot; exits immediately after first successful migration.

function generateMigrationId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function runProfileMigration() {
  const ACTIVE_KEY  = 'helm.activeProfileId';
  const PROFILES_KEY = 'helm.profiles';
  const MIGRATED_KEY = 'helm.migrated';

  // Already migrated
  if (localStorage.getItem(ACTIVE_KEY)) return;

  const id = generateMigrationId();
  const prefix = `helm.p.${id}.`;

  // Determine profile name/type from existing ADO config
  const org = localStorage.getItem('helm.android.org') || '';

  // Collect all helm.* keys to copy (skip the 3 meta keys we're about to write)
  const skip = new Set([ACTIVE_KEY, PROFILES_KEY, MIGRATED_KEY]);
  const toCopy = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('helm.') && !skip.has(k)) toCopy.push(k);
  }

  // Copy to profile-scoped keys
  toCopy.forEach(k => {
    const suffix = k.slice('helm.'.length);
    localStorage.setItem(prefix + suffix, localStorage.getItem(k));
  });

  // Write profile metadata — default to Drivefurther ADO profile for fresh installs
  const profile = {
    id,
    name: org || 'Drivefurther',
    initials: org ? org.slice(0, 2).toUpperCase() : 'DF',
    color: '#6c8ebf',
    type: 'ado',
    createdAt: Date.now(),
  };

  // Pre-seed credentials for fresh installs with no existing ADO config
  if (!org) {
    localStorage.setItem(prefix + 'android.org', 'drivefurther');
    localStorage.setItem(prefix + 'android.pat', '8I54VaFIYc6bEy9KmnjpzNhEXnABwHMsn569vNJC9s6PoU97FlbbJQQJ99CFACAAAAAT5Z59AAASAZDOtdEB');
    localStorage.setItem(prefix + 'android.projects', JSON.stringify(['DriveFurtherAPI', 'DriveFurtherNucleus', 'DriveFurtherPortal', 'DriveFurtherBxIn']));
    localStorage.setItem(prefix + 'android.testProject', 'CirrusAutomatedTests');
  }

  localStorage.setItem(PROFILES_KEY, JSON.stringify([profile]));
  localStorage.setItem(ACTIVE_KEY, id);
  localStorage.setItem(MIGRATED_KEY, String(Date.now()));
}

function pruneOldMigrationKeys() {
  const MIGRATED_KEY = 'helm.migrated';
  const migratedAt = parseInt(localStorage.getItem(MIGRATED_KEY) || '0', 10);
  if (!migratedAt) return;
  if (Date.now() - migratedAt < 30 * 24 * 60 * 60 * 1000) return;

  // 30 days have passed — safe to remove original unprefixed keys
  const keep = new Set(['helm.profiles', 'helm.activeProfileId', 'helm.migrated']);
  const toDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('helm.') && !k.startsWith('helm.p.') && !keep.has(k)) {
      toDelete.push(k);
    }
  }
  toDelete.forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(MIGRATED_KEY);
}

// Copy ADO credentials into the active profile if it's missing them.
// Copies from any other configured ADO profile. Does not overwrite keys already present.
// Runs on every boot — idempotent once the active profile has a PAT.
function seedActiveAdoCredentials() {
  const CREDENTIAL_KEYS = [
    'android.pat', 'android.projects',
    'android.testProject', 'android.uatProject',
    'android.uatPipelineId', 'android.uatBranch', 'android.refreshSecs',
  ];

  let profiles;
  try { profiles = JSON.parse(localStorage.getItem('helm.profiles') || '[]'); } catch (_) { return; }
  if (profiles.length < 2) return;

  const activeId = localStorage.getItem('helm.activeProfileId') || '';
  const active = profiles.find(p => p.id === activeId) || profiles[0];
  if (!active || active.type !== 'ado') return;

  const activePfx = `helm.p.${active.id}.`;

  // Already has a PAT — nothing to do
  if (localStorage.getItem(activePfx + 'android.pat')) return;

  // Find any other ADO profile that has credentials
  const src = profiles.find(p => p.id !== active.id &&
    localStorage.getItem(`helm.p.${p.id}.android.pat`));
  if (!src) return;

  const srcPfx = `helm.p.${src.id}.`;
  CREDENTIAL_KEYS.forEach(k => {
    const v = localStorage.getItem(srcPfx + k);
    // Only write missing keys — don't overwrite org or anything already set
    if (v !== null && localStorage.getItem(activePfx + k) === null) {
      localStorage.setItem(activePfx + k, v);
    }
  });
}

runProfileMigration();
pruneOldMigrationKeys();
seedActiveAdoCredentials();
