// Data & sync: per-profile sync status with Save to server / Load from server, and the conflict queue (Profiles that sync
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
const withSync = (ui, sync, account = { deviceNameDefault: () => 'Laptop' }, extra = {}) => render(
  <ProfileProvider namespace="nexusmd" lifecycle store={{}} storage={makeStorage({ 'nexusmd.profiles': JSON.stringify(PROFILES), 'nexusmd.activeProfileId': 'W' })}>
    <AccountContext.Provider value={{ sync, session: { username: 'ann' }, signOut: async () => {}, ...extra }}>
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
  it('status card lists each live profile with its last sync time, and has no Sync now', async () => {
    const sync = { status: vi.fn(() => status()), onApplied: vi.fn(() => () => {}) };
    withSync(<SyncStatusCard />, sync);
    const work = await screen.findByTestId('sync-row-W');
    expect(within(work).getByText('Work')).toBeTruthy();
    expect(within(work).getByText(/Last synced/)).toBeTruthy();
    const home = screen.getByTestId('sync-row-H');
    expect(within(home).getByText(/Not synced yet/)).toBeTruthy();
    expect(within(home).getByText(/1 item too large to sync/)).toBeTruthy();
    expect(within(home).getByText(/1 conflict/)).toBeTruthy();
    expect(screen.queryByTestId('sync-row-D')).toBeNull(); // deleted profiles are not listed
    expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull();
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

  it('signed out: says so and offers nothing to save or load', () => {
    withSync(<SyncStatusCard />, null);
    expect(screen.getByText(/Sign in to an account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /to server|from server/ })).toBeNull();
  });
});

// Save to server / Load from server, one profile at a time.
describe('SyncStatusCard: Save to server and Load from server', () => {
  afterEach(() => sessionStorage.clear());
  const stub = (over = {}) => ({
    status: vi.fn(() => status()),
    onApplied: vi.fn(() => () => {}),
    push: vi.fn(async () => ({ pushed: 3, conflicts: 0 })),
    pull: vi.fn(async () => ({ applied: 0 })),
    ...over,
  });
  const row = (id) => within(screen.getByTestId(`sync-row-${id}`));

  it('names the account and the server it goes to, and says what the buttons do', async () => {
    withSync(<SyncStatusCard />, stub(), undefined, { serverName: 'api.example.com' });
    const target = await screen.findByTestId('sync-target');
    expect(target.textContent).toMatch(/Signed in as ann · api\.example\.com/);
    expect(target.textContent).toMatch(/Save sends this device's changes/);
    expect(target.textContent).toMatch(/Neither overwrites the other side/);
  });

  it('marks the profile in use as Active, and no other', async () => {
    withSync(<SyncStatusCard />, stub());
    await screen.findByTestId('sync-row-W');
    expect(row('W').getByText('Active')).toBeTruthy();
    expect(row('H').queryByText('Active')).toBeNull();
  });

  it('gives every live profile its own Save and Load, named for it', async () => {
    withSync(<SyncStatusCard />, stub());
    await screen.findByTestId('sync-row-W');
    for (const name of ['Work', 'Home']) {
      expect(screen.getByRole('button', { name: `Save ${name} to the server` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Load ${name} from the server` })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Old/ })).toBeNull();
  });

  it('Save sends that profile alone, and says how much was sent', async () => {
    const sync = stub();
    withSync(<SyncStatusCard />, sync);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Home to the server' }));
    await waitFor(() => expect(sync.push).toHaveBeenCalledWith({ profileId: 'H' }));
    expect(sync.pull).not.toHaveBeenCalled();
    expect(await row('H').findByText('Saved Home to the server: 3 items sent.')).toBeTruthy();
    expect(row('W').queryByText(/Saved Work/)).toBeNull();
  });

  it('Save says when there was nothing new to send', async () => {
    withSync(<SyncStatusCard />, stub({ push: vi.fn(async () => ({ pushed: 0, conflicts: 0 })) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Work to the server' }));
    expect(await row('W').findByText('Nothing new to save for Work.')).toBeTruthy();
  });

  it('Save says when something clashed with the server’s copy, and where to decide', async () => {
    withSync(<SyncStatusCard />, stub({ push: vi.fn(async () => ({ pushed: 2, conflicts: 1 })) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Work to the server' }));
    const said = await row('W').findByRole('alert');
    expect(said.textContent).toMatch(/2 items of Work sent/);
    expect(said.textContent).toMatch(/1 item clashed with the server's copy and needs your decision under Sync conflicts/);
  });

  it('Load fetches that profile alone, and says when it was already up to date', async () => {
    const sync = stub();
    withSync(<SyncStatusCard />, sync);
    fireEvent.click(await screen.findByRole('button', { name: 'Load Work from the server' }));
    await waitFor(() => expect(sync.pull).toHaveBeenCalledWith({ profileId: 'W' }));
    expect(sync.push).not.toHaveBeenCalled();
    expect(await row('W').findByText('Work is already up to date with the server.')).toBeTruthy();
  });

  it('Load that applies something keeps its message for after the page reloads, and shows it once', async () => {
    let listeners = [];
    const sync = stub({
      onApplied: vi.fn((cb) => { listeners.push(cb); return () => { listeners = listeners.filter(c => c !== cb); }; }),
      pull: vi.fn(async () => { listeners.slice().forEach(cb => cb({ applied: 3 })); return { applied: 3 }; }),
    });
    const first = withSync(<SyncStatusCard />, sync);
    fireEvent.click(await screen.findByRole('button', { name: 'Load Home from the server' }));
    await waitFor(() => expect(sync.pull).toHaveBeenCalled());
    expect(JSON.parse(sessionStorage.getItem('nexusmd.sync.notice'))).toEqual({ profileId: 'H', text: 'Loaded Home from the server: 3 changes applied.' });
    first.unmount();
    // the page came back: the message is there, for that profile, and then it is gone
    withSync(<SyncStatusCard />, stub());
    expect(await row('H').findByText('Loaded Home from the server: 3 changes applied.')).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem('nexusmd.sync.notice')).toBeNull());
    expect(row('W').queryByText(/Loaded/)).toBeNull();
  });

  it('shows why a save or load failed, in that profile’s row', async () => {
    const sync = stub({ push: vi.fn(async () => ({ error: { code: 'network', message: 'offline' } })), pull: vi.fn(async () => { throw new Error('boom'); }) });
    withSync(<SyncStatusCard />, sync);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Work to the server' }));
    expect((await row('W').findByRole('alert')).textContent.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Load Home from the server' }));
    await waitFor(() => expect(sync.pull).toHaveBeenCalled());
    expect((await row('H').findByRole('alert')).textContent.length).toBeGreaterThan(0);
  });

  it('shows Saving… on the one that is running and holds every button until it is done', async () => {
    let finish;
    const sync = stub({ push: vi.fn(() => new Promise((r) => { finish = r; })) });
    withSync(<SyncStatusCard />, sync);
    fireEvent.click(await screen.findByRole('button', { name: 'Save Work to the server' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Work to the server' }).textContent).toBe('Saving…'));
    const actions = screen.getAllByRole('button', { name: /to the server|from the server/ });
    expect(actions).toHaveLength(4);
    for (const b of actions) expect(b.disabled).toBe(true);
    finish({ pushed: 1, conflicts: 0 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load Home from the server' }).disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Save Work to the server' }).textContent).toBe('Save to server');
  });

  it('shows when each profile was last saved and loaded, then refreshes after one', async () => {
    const mk = (saved) => status({ W: { lastSyncAt: null, lastSavedAt: saved, lastLoadedAt: T + 3600000, conflicts: 0, tooLarge: [], quota: [], error: null } });
    const sync = stub({ status: vi.fn().mockReturnValueOnce(mk(T)).mockReturnValue(mk(T + 7200000)) });
    withSync(<SyncStatusCard />, sync);
    const work = await screen.findByTestId('sync-row-W');
    expect(work.textContent).toMatch(/Saved to server .* · Loaded from server /);
    expect(work.textContent).not.toMatch(/Last synced/);
    const before = work.textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Save Work to the server' }));
    await waitFor(() => expect(screen.getByTestId('sync-row-W').textContent).not.toBe(before));
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

describe('SyncStatusCard: what is not saved yet', () => {
  afterEach(() => sessionStorage.clear());
  const unsaved = (profiles, unattributed = 0) => ({ profiles, unattributed, total: unattributed + Object.values(profiles).reduce((a, b) => a + b, 0) });
  const stub = (u, over = {}) => ({
    status: vi.fn(() => status()),
    onApplied: vi.fn(() => () => {}),
    push: vi.fn(async () => ({ pushed: 3, conflicts: 0 })),
    pull: vi.fn(async () => ({ applied: 0 })),
    unsaved: vi.fn(async () => u),
    ...over,
  });
  const row = (id) => within(screen.getByTestId(`sync-row-${id}`));

  it('says how many changes each profile has not saved, and offers Save only where there is something to send', async () => {
    withSync(<SyncStatusCard />, stub(unsaved({ W: 3 })));
    await waitFor(() => expect(row('W').getByText(/3 changes not saved/)).toBeTruthy());
    expect(row('W').getByRole('button', { name: 'Save Work to the server' }).disabled).toBe(false);
    expect(row('W').getByRole('button', { name: 'Save Work to the server' }).textContent).toBe('Save to server');
    const home = row('H').getByRole('button', { name: 'Save Home to the server' });
    expect(home.disabled).toBe(true);
    expect(home.textContent).toBe('Nothing to save');
    expect(row('H').queryByText(/not saved/)).toBeNull();
  });

  it('says "1 change", not "1 changes"', async () => {
    withSync(<SyncStatusCard />, stub(unsaved({ W: 1 })));
    await waitFor(() => expect(row('W').getByText(/1 change not saved/)).toBeTruthy());
  });

  it('never says "Nothing to save" for a count it does not have: an engine that cannot count leaves Save on', async () => {
    withSync(<SyncStatusCard />, stub(null, { unsaved: undefined }));
    const btn = await screen.findByRole('button', { name: 'Save Home to the server' });
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save to server');
  });

  it('counts down after a save: Save goes back to disabled once the count is read again', async () => {
    const sync = stub(unsaved({ W: 3 }));
    withSync(<SyncStatusCard />, sync);
    await waitFor(() => expect(row('W').getByText(/3 changes not saved/)).toBeTruthy());
    sync.unsaved.mockResolvedValue(unsaved({}));
    fireEvent.click(row('W').getByRole('button', { name: 'Save Work to the server' }));
    await waitFor(() => expect(row('W').getByRole('button', { name: 'Save Work to the server' }).textContent).toBe('Nothing to save'));
    expect(row('W').queryByText(/not saved/)).toBeNull();
  });
});
