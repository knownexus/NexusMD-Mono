// What the main process says about apps installed as folders of their own (the split layout): for
// each, its manifest, the URL of its renderer code and its stylesheets. Empty when the app is the
// all-in-one build (dev, tests, Mac and Linux), where the apps are bundled into the renderer.
export function splitApps(host = typeof window !== 'undefined' ? window.electronAPI : undefined) {
  try {
    const apps = host?.registry?.get?.()?.split?.apps
    return Array.isArray(apps) ? apps : []
  } catch { return [] }
}
