import { it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { NexusDataProvider, WorkItemsView } from '../src/index.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const base = { type: 'Bug', project: 'proj', state: 'Active', priority: 2, points: 5, tags: [], comments: 0, prs: 0, updated: '3h' };
const ITEMS = [
  { ...base, id: 1, title: 'Alpha task', assignee: 'ann' },
  { ...base, id: 2, title: 'Beta task', assignee: 'bob' },
];
const TEAM = [{ id: 'ann', name: 'Ann', initials: 'AN' }, { id: 'bob', name: 'Bob', initials: 'BO' }];

afterEach(cleanup);

function renderView() {
  const storage = memStorage({ 'nexusmd.wi.view': '"table"', 'nexusmd.wi.grouping': '"assignee"' });
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM, PROJECTS: [] } }}>
      <WorkItemsView items={ITEMS} setItems={() => {}} onOpen={() => {}} team={TEAM} />
    </NexusDataProvider>
  );
}

it('shows Collapse all / Expand all above the grouped table and they work', () => {
  const { container, getByText, queryByText } = renderView();
  const table = container.querySelector('table.table');
  const collapse = getByText('Collapse all').closest('button');
  expect(collapse.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(queryByText('Alpha task')).not.toBeNull();
  fireEvent.click(collapse);
  expect(queryByText('Alpha task')).toBeNull();
  expect(queryByText('Beta task')).toBeNull();
  fireEvent.click(getByText('Expand all').closest('button'));
  expect(queryByText('Alpha task')).not.toBeNull();
  expect(queryByText('Beta task')).not.toBeNull();
});
