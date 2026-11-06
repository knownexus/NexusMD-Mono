'use strict';
// Adds the call reports (packages/trace) to main-process code as it is loaded, when the app runs from source. The
// installed app has them added when it is staged instead (installer/stage.mjs), so this is not installed there.
//
// A file is changed only if packages/trace/src/main-rules.cjs says it is main-process code. A file that cannot be
// changed loads as it is: tracing must never be why the app fails to start.
//
// Changing a file means running Babel over it, which takes seconds for the whole main process. So what comes out is kept in a
// cache folder, per file and keyed by the file's size and modified time and by what the transform is (`signature`), and a
// launch where nothing changed reads it back without even loading Babel.
//
// What is in the cache is run as code, so the folder is the checkout's own (node_modules/.cache, as trusted as the source next to
// it), is made private to the user, and is not used at all if it has been swapped for a link. It is never a shared temp folder,
// where another user could leave an entry for this one to run. The checksum in each entry is against a torn or damaged file, not
// against someone who can write the folder: that person could change the source as well.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { moduleLogger, ignore } = require('@nexusmd/main-kit/logging');

const log = moduleLogger('core', 'trace-hook');
const REPO = path.resolve(__dirname, '..', '..', '..');
const NOTHING = 'none'; // what the cache holds for a file the transform had nothing to change in

const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');

// What the transform is, so that changing it (or what it leaves out) starts the cache again.
function defaultSignature() {
  try {
    const stamp = (id) => fs.statSync(require.resolve(id)).mtimeMs;
    return `${stamp('@nexusmd/trace/instrument')}:${stamp('@nexusmd/trace/exclude.json')}:${stamp('@nexusmd/trace/main-rules')}`;
  } catch (err) {
    ignore(log, 'what the transform is could not be worked out, so the cache is not shared with earlier runs', err);
    return `unknown-${process.pid}`;
  }
}

// The folder, made if need be and private to the user; false when it cannot be made or has been swapped for a link.
function usableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) {
      ignore(log, `the cache folder ${dir} is a link, so it is not used`, new Error('cache folder is a link'), 'warn');
      return false;
    }
    return true;
  } catch (err) {
    ignore(log, 'the cache folder for changed files could not be made, so files are changed on every launch', err, 'warn');
    return false;
  }
}

// An entry is `// nxt:<sha1 of the code>\n<code>` (or `// nxt:none\n`): one that does not check out is treated as missing.
function readEntry(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return undefined; } // not there: a miss
  const at = text.indexOf('\n');
  const head = at < 0 ? text : text.slice(0, at);
  const body = at < 0 ? '' : text.slice(at + 1);
  if (head === `// nxt:${NOTHING}`) return { code: null };
  if (head === `// nxt:${sha(body)}`) return { code: body };
  return undefined;
}

function writeEntry(file, code) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, code === null ? `// nxt:${NOTHING}\n` : `// nxt:${sha(code)}\n${code}`);
    fs.renameSync(tmp, file);
  } catch (err) {
    ignore(log, 'the changed form of a file could not be kept for the next launch', err);
  }
}

/**
 * @param {{ root?: string, instrument?: Function, loadInstrument?: () => Function, shouldTrace?: (relPath: string) => boolean,
 *           cacheDir?: string|false, signature?: string }} [opts]
 *   `root`: the repository root; `shouldTrace(rel)`: whether the file at `rel` (posix, from root) is traced;
 *   `instrument` / `loadInstrument`: the transform, or a function that loads it only when a file has to be changed;
 *   `cacheDir`: where changed files are kept (node_modules/.cache/nexusmd-trace under `root` by default; false for none).
 * @returns {() => void} uninstall
 */
function installTraceHook({ root = REPO, instrument, loadInstrument, shouldTrace, cacheDir, signature } = {}) {
  const decide = shouldTrace || require('@nexusmd/trace/main-rules').shouldTraceMain;
  let transform = instrument ?? null;
  const getTransform = () => (transform ??= (loadInstrument ?? (() => require('@nexusmd/trace/instrument').instrument))());
  const wanted = cacheDir === false ? null : (cacheDir ?? path.join(root, 'node_modules', '.cache', 'nexusmd-trace'));
  const dir = wanted && usableDir(wanted) ? wanted : null;
  const sign = signature ?? (dir ? defaultSignature() : '');
  const extensions = Module._extensions;
  const original = new Map();

  // The code to run for `filename` (null: run the file as it is).
  function changed(filename) {
    const stat = fs.statSync(filename);
    const file = dir ? path.join(dir, `${sha(`${sign}\0${filename}\0${stat.size}\0${stat.mtimeMs}`)}.js`) : null;
    const hit = file ? readEntry(file) : undefined;
    if (hit) return hit.code;
    const out = getTransform()(fs.readFileSync(filename, 'utf8'), { filename, root, sourceType: 'script' });
    const code = out ? out.code : null;
    if (file) writeEntry(file, code);
    return code;
  }

  const wrap = (ext) => {
    const plain = extensions[ext];
    original.set(ext, plain);
    extensions[ext] = function tracedLoader(mod, filename) {
      const rel = path.relative(root, filename).split(path.sep).join('/');
      if (decide(rel)) {
        let code = null;
        try { code = changed(filename); } catch { code = null; } // the plain load below reports anything that is really wrong with the file
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
