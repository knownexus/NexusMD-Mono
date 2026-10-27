import { splitApps } from './split-info.js'

// The split build: loads each installed app's renderer code from its own folder at startup, before
// anything renders. An app that fails to load is left out (and reported) rather than stopping the rest.
const apps = splitApps()

for (const href of new Set(apps.flatMap(app => app.styles || []))) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

const loaded = await Promise.allSettled(apps.map(app => import(/* @vite-ignore */ app.rendererUrl)))

export const appModules = loaded.flatMap((result, i) => {
  if (result.status === 'fulfilled' && result.value?.default) return [result.value.default]
  console.error('App "' + apps[i].id + '" could not be loaded:', result.reason ?? 'it has no default export')
  return []
})
