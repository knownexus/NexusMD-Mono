// Where the shell gets the apps' manifests. This is the all-in-one version: Vite pulls every
// modules/<id>/app.manifest.json in. The split build swaps this file for app-manifests.split.js
// (see vite.split.config.js), which reads them from the apps installed on this machine.
const found = import.meta.glob('../../../../modules/*/app.manifest.json', { eager: true, import: 'default' })

export const appManifests = Object.values(found)
