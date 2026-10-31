// documents-phone.jsx — the Documents page on a phone. One tool at a time (Markdown, JSON, Regex),
// each a single focused pane instead of the desktop's side-by-side panes, with the saved documents
// in a sheet. The tools reuse the shared logic and storage keys, so documents made on the desktop
// layout are still here. The desktop layout (@nexusmd/ui's DocumentsView) is unchanged.
import React from 'react';
import { usePersisted } from '@nexusmd/ui';
import { TOOLS } from './docs-frame.jsx';
import { MarkdownPhone } from './md-phone.jsx';
import { JsonPhone } from './json-phone.jsx';
import { RegexPhone } from './regex-phone.jsx';

export function DocumentsPhone({ onFlash }) {
  const [tool, setTool] = usePersisted('documents_active_tab', 'markdown');
  const active = TOOLS.some(([id]) => id === tool) ? tool : 'markdown';
  const props = { tool: active, setTool, onFlash };
  return active === 'json' ? <JsonPhone {...props}/> : active === 'regex' ? <RegexPhone {...props}/> : <MarkdownPhone {...props}/>;
}
