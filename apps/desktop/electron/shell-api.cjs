'use strict';

// The version of what the shell gives the apps it loads: the shared libraries in the window's import
// map (build/shared.mjs), the preload bridge, and the ctx an app's main register() is passed. Raise it
// when any of those loses or changes something an app may use, and when an app starts using something
// new there: a shared @nexusmd/ui file or export, a preload call, a ctx member. An older shell doesn't
// have it, and an app released on its own would land there and fail to load.
//
// Each app is built against the current number (build/build-split.mjs writes it into the app's
// manifest as requires.shellApi), and a shell with a lower number won't load it. That is what lets an
// app be updated on its own without ever landing in a shell too old for it. Raising it means NexusMD
// is released before any app built after it (app-release.mjs refuses until then).
//
// 2: the shared markdown preview (MarkdownPreview, text size) from @nexusmd/ui, which Editor 1.0.3+ uses.
const SHELL_API = 2;

module.exports = { SHELL_API };
