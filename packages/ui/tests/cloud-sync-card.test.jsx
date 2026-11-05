import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { CloudSyncCard } from '../src/index.js';

const toasts = [];
vi.mock('../src/toast.jsx', async (orig) => ({ ...(await orig()), toast: (msg, type) => { toasts.push([type, msg]); } }));

const noKeyController = {
  hasSyncKey: async () => false,
  getSyncProvider: () => null, setSyncProvider: () => {},
  setSyncPassphrase: async () => {}, clearSyncKey: async () => {},
  syncOnce: async () => ({ skipped: 'no-key' }),
  exportLocalBundle: async () => '', importLocalBundle: async () => ({ collections: [] }),
  getActiveProfileId: () => 'p1',
};
const providers = [{ id: 'gdrive', label: 'Google Drive', isConnected: () => false, connect: async () => {}, disconnect: async () => {} }];
const fileIO = { saveFile: async () => {}, pickFile: async () => null };
const card = (controller) => render(<CloudSyncCard controller={controller} providers={providers} fileIO={fileIO} />);

beforeEach(() => { toasts.length = 0; });
afterEach(cleanup);

describe('CloudSyncCard', () => {
  it('disables local export/import until a passphrase is set', async () => {
    card(noKeyController);
    await waitFor(() => expect(screen.getByText('Export to file')).toBeTruthy());
    expect(screen.getByText('Export to file').disabled).toBe(true);
    expect(screen.getByText('Import from file').disabled).toBe(true);
  });
});

// A sync that skipped an item it could not read must not look like a clean one.
describe('CloudSyncCard: items that could not be read', () => {
  const okResult = { pushed: 1, pulled: 0, merged: 0 };
  const withUnreadable = { ...okResult, unreadable: ['planner/2026-W26', 'notes/data'] };

  it('says nothing when the last run read everything', async () => {
    card({ ...noKeyController, getLastResult: () => okResult });
    await waitFor(() => expect(screen.getByText('Last: pushed 1, pulled 0, merged 0')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the items by name on opening, from the last run (a background sync included)', async () => {
    card({ ...noKeyController, getLastResult: () => withUnreadable });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('2 items could not be read');
    expect(alert.textContent).toContain('Planner week 2026-W26');
    expect(alert.textContent).toContain('Notes');
    expect(alert.textContent).toMatch(/left alone/);
    expect(alert.textContent).toMatch(/Importing a bundle that has an item replaces it/);
    expect(screen.getByText('Last: pushed 1, pulled 0, merged 0 and 2 items could not be read')).toBeTruthy();
  });

  it('uses the singular for one item, and falls back to the raw name for an unknown collection', async () => {
    card({ ...noKeyController, getLastResult: () => ({ ...okResult, unreadable: ['mystery/x'] }) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 item could not be read');
    expect(alert.textContent).toContain('mystery/x');
  });

  it('appears when a background sync finishes, and goes when a later one reads everything', async () => {
    card({ ...noKeyController, getLastResult: () => null });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-finished', { detail: withUnreadable })); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-finished', { detail: okResult })); });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('Sync now does not report success when an item was skipped', async () => {
    const syncOnce = vi.fn(async () => withUnreadable);
    card({ ...noKeyController, syncOnce });
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0][0]).toBe('error');
    expect(toasts[0][1]).toBe('Synced, but 2 items could not be read and were left alone.');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('Sync now still reports plain success when everything was read', async () => {
    card({ ...noKeyController, syncOnce: async () => okResult });
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0]).toEqual(['success', 'Synced — pushed 1, pulled 0, merged 0.']);
  });

  it('works with a controller that cannot report a last run', async () => {
    card(noKeyController);
    await waitFor(() => expect(screen.getByText('Export to file')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// Restore from cloud: an explicit action on the unreadable row, replacing the damaged items with the cloud's copy.
describe('CloudSyncCard: restore from cloud', () => {
  const result = { pushed: 0, pulled: 0, merged: 0, unreadable: ['planner/2026-W26', 'notes/data'] };
  const withRestore = (restoreUnreadable) => ({ ...noKeyController, getLastResult: () => result, restoreUnreadable });
  const restoreButton = () => screen.getByRole('button', { name: 'Restore from cloud' });

  it('offers it on the row, and not when the controller cannot do it', async () => {
    card(withRestore(vi.fn()));
    await screen.findByRole('alert');
    expect(restoreButton()).toBeTruthy();
    cleanup();
    card({ ...noKeyController, getLastResult: () => result });
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Restore from cloud' })).toBeNull();
  });

  it('says what it does: the cloud copy replaces it and the damaged one is kept', async () => {
    card(withRestore(vi.fn()));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Restore from cloud replaces them with the copy in the cloud/);
    expect(alert.textContent).toMatch(/damaged copy is kept on this device/);
  });

  it('restores every listed item and reports success', async () => {
    const restoreUnreadable = vi.fn(async () => ({ restored: [{ item: 'planner/2026-W26', backup: 'b1' }, { item: 'notes/data', backup: 'b2' }], failed: [] }));
    card(withRestore(restoreUnreadable));
    await screen.findByRole('alert');
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(restoreUnreadable).toHaveBeenCalledWith(['planner/2026-W26', 'notes/data']);
    expect(toasts[0]).toEqual(['success', 'Restored 2 items from the cloud, and kept the damaged copies on this device.']);
  });

  it('reports what could not be restored, and why, as an error', async () => {
    const restoreUnreadable = vi.fn(async () => ({
      restored: [{ item: 'planner/2026-W26', backup: 'b1' }],
      failed: [{ item: 'notes/data', reason: 'not-in-cloud' }],
    }));
    card(withRestore(restoreUnreadable));
    await screen.findByRole('alert');
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0][0]).toBe('error');
    expect(toasts[0][1]).toBe('Restored 1 item from the cloud, and kept the damaged copy on this device. 1 item could not be restored: the cloud has no copy.');
  });

  it('explains a failure to keep the damaged copy first: nothing was replaced', async () => {
    card(withRestore(vi.fn(async () => ({ restored: [], failed: [{ item: 'planner/2026-W26', reason: 'could-not-back-up' }] }))));
    await screen.findByRole('alert');
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0]).toEqual(['error', '1 item could not be restored: this device has no room to keep the damaged copy first, so nothing was replaced.']);
  });

  it('says why it could not run, the way Sync now does', async () => {
    card(withRestore(vi.fn(async () => ({ skipped: 'not-connected' }))));
    await screen.findByRole('alert');
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0]).toEqual(['info', 'Connect your cloud provider first.']);
  });

  it('reports an unexpected failure, and is disabled while it runs', async () => {
    let release;
    const restoreUnreadable = vi.fn(() => new Promise((_, reject) => { release = () => reject(new Error('network')); }));
    card(withRestore(restoreUnreadable));
    await screen.findByRole('alert');
    fireEvent.click(restoreButton());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restoring…' }).disabled).toBe(true));
    act(() => release());
    await waitFor(() => expect(toasts).toEqual([['error', 'Restore failed: network']]));
    expect(restoreButton().disabled).toBe(false);
  });
});
