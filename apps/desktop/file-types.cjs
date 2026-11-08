'use strict';
// The file types NexusMD offers to open, so it appears under "Open with" and in the default-apps list. The same types the Android
// app offers (AndroidManifest.xml), and routed the same way once opened: Markdown and JSON become documents in the Documents
// app, everything else opens in the Editor. installer/installer.test.js keeps this list and the Android one the same.
//
// Used by electron-builder.win.cjs (the Windows installer) and, as the same list written out, by package.json's "build"
// block (Mac and Linux). Build-time only: nothing at run time reads it.
const OTHER = [
  'txt', 'log', 'csv', 'yml', 'yaml', 'xml', 'ini', 'toml', 'conf', 'cfg', 'properties',
  'cs', 'csx', 'js', 'mjs', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'less',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'php', 'rb', 'sh', 'sql', 'ps1',
];

const fileAssociations = [
  { ext: ['md', 'markdown'], name: 'Markdown document', role: 'Editor' },
  { ext: ['json'], name: 'JSON file', role: 'Editor' },
  { ext: OTHER, name: 'Text or code file', role: 'Editor' },
];

module.exports = { fileAssociations };
