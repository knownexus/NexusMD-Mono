// devenv source branch <repo>: devenv opens its branch picker, and the next build uses the pick.
// Kept in the app rather than @nexusmd/core, which comes from the installed NexusMD, so an app
// update alone can ship it.
export function buildBranchArgv(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(key)) throw new Error(`Not a repository key: ${key}`)
  return ['source', 'branch', key]
}
