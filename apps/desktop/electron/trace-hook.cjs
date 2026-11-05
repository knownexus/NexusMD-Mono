'use strict';
// Adds the call reports (packages/trace) to main-process code as it is loaded, when the app runs from source. The
// installed app has them added when it is staged instead (installer/stage.mjs), so this is not installed there.
//
// A file is changed only if packages/trace/src/main-rules.cjs says it is main-process code. A file that cannot be
// changed loads as it is: tracing must never be why the app fails to start.

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const REPO = path.resolve(__dirname, '..', '..', '..');

/**
 * @param {{ root?: string, instrument?: Function, shouldTrace?: (relPath: string) => boolean }} [opts]
 *   `root`: the repository root; `shouldTrace(rel)`: whether the file at `rel` (posix, from root) is traced.
 * @returns {() => void} uninstall
 */
function installTraceHook({ root = REPO, instrument, shouldTrace } = {}) {
  const decide = shouldTrace || require('@nexusmd/trace/main-rules').shouldTraceMain;
  const transform = instrument || require('@nexusmd/trace/instrument').instrument;
  const extensions = Module._extensions;
  const original = new Map();

  const wrap = (ext) => {
    const plain = extensions[ext];
    original.set(ext, plain);
    extensions[ext] = function tracedLoader(mod, filename) {
      const rel = path.relative(root, filename).split(path.sep).join('/');
      if (decide(rel)) {
        let code = null;
        try {
          const out = transform(fs.readFileSync(filename, 'utf8'), { filename, root, sourceType: 'script' });
          code = out ? out.code : null;
        } catch { code = null; } // the plain load below reports anything that is really wrong with the file
        if (code !== null) { mod._compile(code, filename); return undefined; }
      }
      return plain(mod, filename);
    };
  };

  wrap('.js');
  if (extensions['.cjs']) wrap('.cjs'); // (Node loads .cjs through the .js handler when it has no handler of its own)

  return () => { for (const [ext, plain] of original) extensions[ext] = plain; };
}

module.exports = { installTraceHook };
