import { splitApps } from './split-info.js'
import { appModules } from './app-code.split.js'

// The split build: the manifests of the installed apps whose code loaded. An app that failed to load
// (see app-code.split.js) is left out here too, so it doesn't leave a sidebar entry with nothing behind it.
const loaded = new Set(appModules.map(m => m.id))

export const appManifests = splitApps().map(app => app.manifest).filter(manifest => loaded.has(manifest.id))
