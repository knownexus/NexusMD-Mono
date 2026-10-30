import { NEXUSMD_THEMES, THEME_MODES } from '../../../packages/ui/src/themes.js'

// The saved palette, applied by an inline script before anything else on the page runs. Without it a
// reload (e.g. after an app update) paints the window's OS-themed background and the default light
// palette until the app's code has loaded and React has set body[data-theme].

// Each palette's page background (its swatch's first colour is its --bg token).
export const THEME_BACKGROUNDS = Object.fromEntries(NEXUSMD_THEMES.map(t => [t.id, t.swatch[0]]))

// The same choice as paletteFor() in @nexusmd/ui's themes.js, over the tweaks main.jsx saves.
export function themePreloadScript() {
  const modes = Object.fromEntries(THEME_MODES.map(m => [m.id, { key: m.key, fallback: m.fallback }]))
  return `(function(){
  var modes = ${JSON.stringify(modes)}, backgrounds = ${JSON.stringify(THEME_BACKGROUNDS)}, tweaks = {};
  try { tweaks = JSON.parse(localStorage.getItem('nexusmd.tweaks') || '{}') || {}; } catch (e) {}
  var mode = modes[tweaks.theme] || modes[${JSON.stringify(THEME_MODES[0].id)}];
  var palette = tweaks[mode.key] || mode.fallback;
  document.body.dataset.theme = palette;
  if (backgrounds[palette]) document.documentElement.style.backgroundColor = backgrounds[palette];
})();`
}

// Vite plugin: puts the script first in <body>, so it runs before the app's module scripts.
export const themePreload = () => ({
  name: 'nexusmd-theme-preload',
  transformIndexHtml: () => [{ tag: 'script', children: themePreloadScript(), injectTo: 'body-prepend' }],
})
