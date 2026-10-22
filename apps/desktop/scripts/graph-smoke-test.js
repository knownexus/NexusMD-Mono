#!/usr/bin/env node
'use strict';
// Manual, dev-only check that real OAuth + Graph wiring works end-to-end.
// GRAPH_TOKEN must be a live access token (copy one from a debug log during a
// real Microsoft sign-in). Calls /me — the lowest-permission Graph endpoint
// (User.Read only, already granted) — so it's usable without any extra scope
// consent. Not run in CI.
// Run: GRAPH_TOKEN=eyJ... npm run graph:smoke

import { graphJSON } from '@nexusmd/core';

async function main() {
  const token = process.env.GRAPH_TOKEN;
  if (!token) {
    console.error('Set GRAPH_TOKEN to a live Microsoft Graph access token first.');
    process.exit(1);
  }
  const me = await graphJSON(() => token, '/me');
  console.log('Graph /me responded:');
  console.log(JSON.stringify(me, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
