// migrate.js — one-time storage migration planner.
//
// Some platforms (historically desktop) stored everything flat under
// `${namespace}.<key>` with no profile registry. Once a profile registry is
// introduced, getProfileKey scopes reads/writes to `${namespace}.p.<id>.<key>`,
// which would orphan all the pre-existing flat data. This pure planner returns
// the list of {from,to} key moves that fold the flat data into a profile's
// scoped namespace. The caller applies the moves against its real storage.
//
// Left untouched: the registry/app-level keys (`${namespace}.profiles`,
// `${namespace}.activeProfileId`) and keys already scoped under
// `${namespace}.p.`.

/**
 * Plan the flat → profile-scoped key migration.
 *
 * @param {string[]} keys       Current storage keys (snapshot).
 * @param {string}   namespace  Key prefix without trailing dot (e.g. 'nexusmd').
 * @param {string}   profileId  The profile id to fold flat data into.
 * @returns {{ from: string, to: string }[]}  Moves to apply (copy then remove).
 */
export function planProfileScopeMigration(keys, namespace, profileId) {
  const prefix   = `${namespace}.`;
  const scoped   = `${namespace}.p.`;
  const reserved = new Set([`${namespace}.profiles`, `${namespace}.activeProfileId`]);
  const moves = [];
  for (const k of keys || []) {
    if (!k || !k.startsWith(prefix)) continue;  // not ours
    if (k.startsWith(scoped)) continue;          // already scoped
    if (reserved.has(k)) continue;               // registry / app-level
    const bare = k.slice(prefix.length);
    moves.push({ from: k, to: `${scoped}${profileId}.${bare}` });
  }
  return moves;
}
