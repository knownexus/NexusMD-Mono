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
