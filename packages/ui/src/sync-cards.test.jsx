// Data & sync: per-profile sync status, Sync now, and the conflict queue (Profiles that sync
// everything, Task 10).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AccountContext } from './account-gate.jsx';
import { ProfileProvider } from './profile-context.jsx';
import { SyncStatusCard } from './sync-status-card.jsx';
import { SyncConflictsCard } from './sync-conflicts.jsx';

afterEach(cleanup);

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
  };
}
const PROFILES = [
  { id: 'W', name: 'Work', updatedAt: 1 }, { id: 'H', name: 'Home', updatedAt: 1 },
  { id: 'D', name: 'Old', updatedAt: 1, deletedAt: 2 },
];
const withSync = (ui, sync, account = { deviceNameDefault: () => 'Laptop' }) => render(
  <ProfileProvider namespace="nexusmd" lifecycle store={{}} storage={makeStorage({ 'nexusmd.profiles': JSON.stringify(PROFILES), 'nexusmd.activeProfileId': 'W' })}>
    <AccountContext.Provider value={{ sync, session: { username: 'ann' }, signOut: async () => {} }}>
      {React.cloneElement(ui, { account })}
    </AccountContext.Provider>
  </ProfileProvider>,
);

const T = Date.UTC(2026, 10, 4, 9, 30);
const status = (over = {}) => ({
  lastSyncAt: T,
  profiles: {
    W: { lastSyncAt: T, conflicts: 0, tooLarge: [], quota: [], error: null },
    H: { lastSyncAt: null, conflicts: 1, tooLarge: ['nexusmd:p.H.planner.versions#v1'], quota: [], error: null },
    D: { lastSyncAt: T, conflicts: 0, tooLarge: [], quota: [], error: null },
    ...over,
  },
});

describe('SyncStatusCard', () => {
  it('status card lists each live profile with last sync time and a Sync now button that calls syncNow', async () => {
    const sync = { status: vi.fn(() => status()), syncNow: vi.fn(async () => ({ pushed: 0 })), onApplied: vi.fn(() => () => {}) };
    withSync(<SyncStatusCard />, sync);
    const work = await screen.findByTestId('sync-row-W');
    expect(within(work).getByText('Work')).toBeTruthy();
    expect(within(work).getByText(/Last synced/)).toBeTruthy();
    const home = screen.getByTestId('sync-row-H');
    expect(within(home).getByText(/Not synced yet/)).toBeTruthy();
    expect(within(home).getByText(/1 item too large to sync/)).toBeTruthy();
    expect(within(home).getByText(/1 conflict/)).toBeTruthy();
    expect(screen.queryByTestId('sync-row-D')).toBeNull(); // deleted profiles are not listed
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(sync.syncNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sync.status).toHaveBeenCalledTimes(2)); // refreshed after the sync
  });

  it('says when this device could not read an item, under its profile and for items that belong to none', async () => {
    const sync = {
      status: vi.fn(() => ({ ...status({ W: { lastSyncAt: T, conflicts: 0, tooLarge: [], quota: [], error: null, unreadable: ['nexusmd:p.W.lists', 'nexusmd:p.W.notes'] } }), unreadable: ['profiles'] })),
      syncNow: vi.fn(), onApplied: vi.fn(() => () => {}),
    };
    withSync(<SyncStatusCard />, sync);
    const work = await screen.findByTestId('sync-row-W');
    expect(within(work).getByText(/2 items could not be read on this device/)).toBeTruthy();
    expect(within(screen.getByTestId('sync-row-H')).queryByText(/could not be read/)).toBeNull();
    const alone = screen.getByTestId('sync-unreadable');
    expect(alone.textContent).toMatch(/1 item that belongs to no profile could not be read on this device/);
    expect(alone.textContent).toMatch(/It was left alone/);
  });

  it('shows nothing about unreadable items when there are none', async () => {
    const sync = { status: vi.fn(() => status()), syncNow: vi.fn(), onApplied: vi.fn(() => () => {}) };
    withSync(<SyncStatusCard />, sync);
    await screen.findByTestId('sync-row-W');
    expect(screen.queryByTestId('sync-unreadable')).toBeNull();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('a profile whose last sync failed shows the error on its row', async () => {
    const sync = { status: vi.fn(() => status({ W: { lastSyncAt: T, conflicts: 0, tooLarge: [], quota: [], error: 'offline' } })), syncNow: vi.fn(), onApplied: vi.fn(() => () => {}) };
    withSync(<SyncStatusCard />, sync);
    expect(within(await screen.findByTestId('sync-row-W')).getByText(/Last sync failed: offline/)).toBeTruthy();
  });

  it('signed out: says so and offers no Sync now', () => {
    withSync(<SyncStatusCard />, null);
    expect(screen.getByText(/Sign in to an account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });
});

const rec = (o) => JSON.stringify(o);
const conflict = (over) => ({
  id: 'nexusmd:p.W.md_documents#d1', profileId: 'W', kind: 'record', detectedAt: T,
  local: { value: rec({ id: 'd1', name: 'Notes', content: 'one\nmine\nthree' }), deleted: false },
  remote: { value: rec({ id: 'd1', name: 'Notes', content: 'one\ntheirs\nthree' }), deleted: false, updatedAt: T, revision: 4 },
  ...over,
});
const conflictSync = (list) => ({
  conflicts: vi.fn(() => list),
  resolve: vi.fn(async () => ({})),
  keepBoth: vi.fn(async () => ({})),
  onConflict: vi.fn(() => () => {}),
});

describe('SyncConflictsCard', () => {
  it('conflicts card lists open conflicts', () => {
    const sync = conflictSync([conflict(), conflict({ id: 'p.H.ado.org', profileId: 'H', kind: 'plain', local: { value: 'a', deleted: false }, remote: { value: 'b', deleted: false, updatedAt: T, revision: 2 } })]);
    withSync(<SyncConflictsCard />, sync);
    expect(screen.getByText('Work · md_documents d1')).toBeTruthy();
    expect(screen.getByText('Home · ado.org')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(2);
  });

  it('none: says there is nothing to resolve', () => {
    withSync(<SyncConflictsCard />, conflictSync([]));
    expect(screen.getByText(/No sync conflicts/)).toBeTruthy();
  });

  it('Keep both is offered for records only', () => {
    const sync = conflictSync([conflict()]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('button', { name: 'Keep both' })).toBeTruthy();
    cleanup();
    const field = conflict({ id: 'nexusmd:p.W.tweaks#theme', kind: 'field', local: { value: '"dark"', deleted: false }, remote: { value: '"light"', deleted: false, updatedAt: T, revision: 2 } });
    withSync(<SyncConflictsCard />, conflictSync([field]));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.queryByRole('button', { name: 'Keep both' })).toBeNull();
  });

  it('Keep both names the copy with the device and date', async () => {
    const sync = conflictSync([conflict()]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(sync.keepBoth).toHaveBeenCalledTimes(1));
    const { copyName } = sync.keepBoth.mock.calls[0][1];
    expect(copyName('Notes')).toMatch(/^Notes \(conflicted copy, Laptop, \d{4}-\d{2}-\d{2}\)$/);
  });

  it('resolving a text conflict by taking theirs for one hunk sends the merged text', async () => {
    const sync = conflictSync([conflict()]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const hunks = screen.getAllByTestId('conflict-hunk');
    expect(hunks).toHaveLength(1);
    fireEvent.click(within(hunks[0]).getByLabelText('Use theirs'));
    expect(screen.getByLabelText('Result').value).toBe('one\ntheirs\nthree');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sync.resolve).toHaveBeenCalledTimes(1));
    const [id, choice] = sync.resolve.mock.calls[0];
    expect(id).toBe('nexusmd:p.W.md_documents#d1');
    expect(JSON.parse(choice.value)).toEqual({ id: 'd1', name: 'Notes', content: 'one\ntheirs\nthree' });
  });

  it('the result can be edited by hand before saving', async () => {
    const sync = conflictSync([conflict()]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'one\nboth\nthree' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(sync.resolve.mock.calls[0][1].value).content).toBe('one\nboth\nthree'));
  });

  it('resolving a structured conflict sends the chosen fields', async () => {
    const entry = conflict({
      id: 'nexusmd:p.W.timelog.v1#e1', kind: 'record',
      local: { value: rec({ id: 'e1', minutes: 30, task: 'Build', note: 'x' }), deleted: false },
      remote: { value: rec({ id: 'e1', minutes: 45, task: 'Review', note: 'x' }), deleted: false, updatedAt: T, revision: 3 },
    });
    const sync = conflictSync([entry]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const rows = screen.getAllByTestId('conflict-field');
    expect(rows.map((r) => r.dataset.field)).toEqual(['minutes', 'task']); // only the differing fields
    fireEvent.click(within(rows[0]).getByLabelText('Use theirs'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sync.resolve).toHaveBeenCalledTimes(1));
    expect(JSON.parse(sync.resolve.mock.calls[0][1].value)).toEqual({ id: 'e1', minutes: 45, task: 'Build', note: 'x' });
  });

  it('a deletion on one side offers keeping either version', async () => {
    const sync = conflictSync([conflict({ remote: { value: null, deleted: true, updatedAt: T, revision: 5 } })]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText(/deleted on the other device/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Keep this device's version" }));
    await waitFor(() => expect(sync.resolve).toHaveBeenCalledWith('nexusmd:p.W.md_documents#d1', { take: 'local' }));
  });

  it('a token conflict never shows the values', async () => {
    const sync = conflictSync([conflict({ id: 'p.W.ado.pat', kind: 'secret', local: { value: null, deleted: false }, remote: { value: null, deleted: false, updatedAt: T, revision: 2 } })]);
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText(/saved sign-in or token/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Use the other device's version" }));
    await waitFor(() => expect(sync.resolve).toHaveBeenCalledWith('p.W.ado.pat', { take: 'remote' }));
  });

  it('a refused resolution shows why and keeps the dialog open', async () => {
    const sync = conflictSync([conflict()]);
    sync.resolve = vi.fn(async () => ({ error: Object.assign(new Error('changed'), { code: 'conflict' }) }));
    withSync(<SyncConflictsCard />, sync);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
