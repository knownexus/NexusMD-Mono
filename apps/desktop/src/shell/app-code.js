// Where the shell gets the apps' renderer code. This is the all-in-one version: Vite bundles every
// modules/<id>/src/renderer/index.js in. The split build swaps this file for app-code.split.js, which
// loads only the apps installed on this machine, from their own folders.
const found = import.meta.glob('../../../../modules/*/src/renderer/index.js', { eager: true, import: 'default' })

export const appModules = Object.values(found)
