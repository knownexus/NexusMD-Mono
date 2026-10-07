import { it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { NexusDataProvider, WorkItemsView } from '../src/index.js';

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const base = { type: 'Bug', state: 'Active', priority: 2, points: 5, tags: [], comments: 0, prs: 0, updated: '3h' };
const ITEMS = [
  { ...base, id: 1, title: 'Alpha task', assignee: 'ann', project: 'p1' },
  { ...base, id: 2, title: 'Beta task', assignee: 'bob', project: 'p2' },
];
const TEAM = [{ id: 'ann', name: 'Ann', initials: 'AN' }, { id: 'bob', name: 'Bob', initials: 'BO' }];
const PROJECTS = [{ id: 'p1', name: 'P One', color: '#f00' }, { id: 'p2', name: 'P Two', color: '#0f0' }];

afterEach(cleanup);

function mount(storage) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM, PROJECTS } }}>
      <WorkItemsView items={ITEMS} setItems={() => {}} onOpen={() => {}} team={TEAM} />
    </NexusDataProvider>
  );
}
const tableStorage = (extra = {}) => memStorage({ 'nexusmd.wi.view': '"table"', 'nexusmd.wi.grouping': '"assignee"', ...extra });
const boardStorage = (extra = {}) => memStorage({ 'nexusmd.wi.view': '"board"', 'nexusmd.wi.boardGrouping': '"assignee"', ...extra });

it('table: collapse all survives unmount/remount', () => {
  const storage = tableStorage();
  const a = mount(storage);
  fireEvent.click(a.getByText('Collapse all').closest('button'));
  expect(a.queryByText('Alpha task')).toBeNull();
  a.unmount();
  const b = mount(storage);
  expect(b.queryByText('Alpha task')).toBeNull();
  expect(b.queryByText('Beta task')).toBeNull();
});

it('table: a single group header collapse survives remount', () => {
  const storage = tableStorage();
  const a = mount(storage);
  fireEvent.click(a.container.querySelector('table.table tbody tr'));
  const visible = v => ['Alpha task', 'Beta task'].filter(t => v.queryByText(t));
  expect(visible(a)).toHaveLength(1);
  const before = visible(a);
  a.unmount();
  const b = mount(storage);
  expect(visible(b)).toEqual(before);
});

it('table: each grouping keeps its own state and Expand all clears only the current one', () => {
  const storage = tableStorage();
  const a = mount(storage);
  fireEvent.click(a.getByText('Collapse all').closest('button'));
  a.unmount();
  // different grouping starts expanded
  storage.setItem('nexusmd.wi.grouping', '"project"');
  const b = mount(storage);
  expect(b.queryByText('Alpha task')).not.toBeNull();
  fireEvent.click(b.getByText('Collapse all').closest('button'));
  expect(b.queryByText('Alpha task')).toBeNull();
  fireEvent.click(b.getByText('Expand all').closest('button'));
  expect(b.queryByText('Alpha task')).not.toBeNull();
  b.unmount();
  const stored = JSON.parse(storage.getItem('nexusmd.wi.collapsed.table'));
  expect(Object.keys(stored.assignee || {}).length).toBeGreaterThan(0);
  expect(Object.keys(stored.project || {}).length).toBe(0);
  // back to assignee: still collapsed
  storage.setItem('nexusmd.wi.grouping', '"assignee"');
  const c = mount(storage);
  expect(c.queryByText('Alpha task')).toBeNull();
});

it('board: swimlane collapse survives remount, per grouping', () => {
  const storage = boardStorage();
  const a = mount(storage);
  expect(a.queryByText('Alpha task')).not.toBeNull();
  fireEvent.click(a.getByText('Collapse all').closest('button'));
  expect(a.queryByText('Alpha task')).toBeNull();
  a.unmount();
  const b = mount(storage);
  expect(b.queryByText('Alpha task')).toBeNull();
  b.unmount();
  storage.setItem('nexusmd.wi.boardGrouping', '"project"');
  const c = mount(storage);
  expect(c.queryByText('Alpha task')).not.toBeNull();
  c.unmount();
  storage.setItem('nexusmd.wi.boardGrouping', '"assignee"');
  const d = mount(storage);
  fireEvent.click(d.getByText('Expand all').closest('button'));
  expect(d.queryByText('Alpha task')).not.toBeNull();
  expect(JSON.parse(storage.getItem('nexusmd.wi.collapsed.board')).assignee).toEqual({});
});
