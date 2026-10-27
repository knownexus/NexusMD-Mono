'use strict';

// The version of what the shell gives the apps it loads: the shared libraries in the window's import
// map (build/shared.mjs), the preload bridge, and the ctx an app's main register() is passed. Raise it
// when any of those loses or changes something an app may use; adding something new doesn't need it.
//
// Each app is built against the current number (build/build-split.mjs writes it into the app's
// manifest as requires.shellApi), and a shell with a lower number won't load it. That is what lets an
// app be updated on its own without ever landing in a shell too old for it.
const SHELL_API = 1;

module.exports = { SHELL_API };
