'use strict';
// The Windows build: an installer where the user ticks the apps (installer/installer.nsh), and a
// portable build that holds every app. The macOS and Linux builds keep the "build" block of
// package.json, which is the all-in-one app.
//
//   NEXUSMD_WIN_TARGET=nsis      the installer (apps are inside the installer, copied only when ticked)
//   NEXUSMD_WIN_TARGET=portable  one exe with all the apps
//
// build-win.mjs stages the main process, builds the apps and runs electron-builder with this file.
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const split = path.join(repo, 'dist', 'desktop', 'split');
const target = process.env.NEXUSMD_WIN_TARGET || 'nsis';
if (!['nsis', 'portable'].includes(target)) throw new Error(`NEXUSMD_WIN_TARGET must be nsis or portable, not "${target}"`);

// NEXUSMD_INSTALLER_TEST=1 builds an installer that can be tried on a machine that has NexusMD: it has an
// id and a name of its own, so it neither replaces that install nor shares its registry entries.
const test = process.env.NEXUSMD_INSTALLER_TEST === '1';

module.exports = {
  appId: test ? 'com.knownexus.nexusmd.installtest' : 'com.knownexus.nexusmd',
  productName: test ? 'NexusMD Installer Test' : 'NexusMD',
  icon: 'assets/icon.ico',
  directories: {
    app: path.join(repo, 'dist', 'desktop', 'stage'),
    output: path.join(repo, 'dist', 'desktop', 'release'),
    buildResources: path.join(__dirname, 'installer'),
  },
  // The shell is always installed. Apps are installed by the installer when ticked, or all here (portable).
  extraResources: [
    { from: path.join(split, 'shell'), to: 'renderer' },
    ...(target === 'portable' ? [{ from: path.join(split, 'apps'), to: 'apps' }] : []),
  ],
  asarUnpack: [],
  win: {
    target: [{ target, arch: ['x64'] }],
    icon: 'assets/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    include: path.join(__dirname, 'installer', 'installer.nsh'),
  },
  // nexusmd:// links open this install; the uninstaller removes the registration. Not for the test
  // installer, which must not take the links over from a real install.
  ...(test ? {} : { protocols: [{ name: 'NexusMD', schemes: ['nexusmd'] }] }),
  // A published release, as package.json's config makes for Mac and Linux. Left out, this defaults to a
  // draft, and electron-builder skips the upload (with only a warning) when another platform has
  // already created the release as published.
  publish: { provider: 'github', owner: 'knownexus', repo: 'NexusMD-Mono', releaseType: 'release' },
};
