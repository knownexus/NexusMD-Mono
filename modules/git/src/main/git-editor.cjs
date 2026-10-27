// electron/ipc/git-editor.cjs
//
// Git's editor during NexusMD's interactive rebase, run as
// `ELECTRON_RUN_AS_NODE=1 "<electron>" "git-editor.cjs" <mode>` (git appends the file). The plan (todo
// text and messages) comes from the JSON file named by NEXUSMD_REBASE_PLAN, written by main before
// the rebase starts. `sequence` replaces git's todo; `message` writes the message the user gave for
// the commit being edited, found from the last line of <git dir>/rebase-merge/done, and otherwise
// leaves git's text as it is. Any failure exits non-zero, which makes git stop the rebase.
'use strict';
const fs = require('fs');
const path = require('path');

function main(argv, env) {
  const [mode, file] = argv;
  const plan = JSON.parse(fs.readFileSync(env.NEXUSMD_REBASE_PLAN, 'utf8'));
  if (mode === 'sequence') { fs.writeFileSync(file, plan.todo); return 0; }
  if (mode !== 'message') return 2;
  const done = path.join(path.dirname(file), 'rebase-merge', 'done');
  if (!fs.existsSync(done)) return 0;
  const last = fs.readFileSync(done, 'utf8').trim().split('\n').pop() || '';
  const oid = last.split(/\s+/)[1] || '';
  const message = Object.prototype.hasOwnProperty.call(plan.messages, oid) ? plan.messages[oid] : null;
  if (message != null) fs.writeFileSync(file, message.endsWith('\n') ? message : `${message}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2), process.env); } catch (e) { process.stderr.write(`nexusmd editor: ${e.message}\n`); process.exitCode = 1; }
}
module.exports = { main };
