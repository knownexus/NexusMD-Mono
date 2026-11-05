'use strict';
// Recording the app: the recorder (one per app instance), the recording files, the link between a window call and the
// IPC call it makes, and the redaction recordings go through.
//   const recorder = createRecorder({ dir })        // the shell makes one
//   recorder.start('merge a PR'); …; await recorder.stop()
//   recorder.store.list()
const { createRecorder } = require('./recorder.cjs');
const { createStore } = require('./store.cjs');
const { createTraceLink } = require('./link.cjs');
const { createRedactor, DEFAULT_DENY } = require('./redact-trace.cjs');

module.exports = { createRecorder, createStore, createTraceLink, createRedactor, DEFAULT_DENY };
