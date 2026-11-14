import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { AccountContext } from './account-gate.jsx';
import { useSyncSummary, refreshSyncSummary } from './sync-summary.js';

afterEach(cleanup);

const mkSync = (over = {}) => {
  const cbs = {};
  const sync = {
    unsaved: vi.fn(async () => ({ profiles: { W: 2 }, unattributed: 1, total: 3 })),
    status: vi.fn(() => ({ lastSyncAt: 5, profiles: { W: { conflicts: 1, error: null }, H: { conflicts: 2, error: 'boom' } } })),
    onApplied: vi.fn((cb) => { cbs.applied = cb; return () => { cbs.applied = null; }; }),
    onConflict: vi.fn((cb) => { cbs.conflict = cb; return () => {}; }),
    onError: vi.fn((cb) => { cbs.error = cb; return () => {}; }),
    ...over,
  };
  return { sync, cbs };
};

function Probe({ pollMs = 0 }) {
  const s = useSyncSummary({ pollMs });
  return <div data-testid="s">{JSON.stringify({ known: s.known, total: s.unsaved.total, conflicts: s.conflicts, error: s.error, last: s.lastSyncAt })}</div>;
}
const mount = (sync, props) => render(<AccountContext.Provider value={{ sync }}><Probe {...props} /></AccountContext.Provider>);
const read = () => JSON.parse(screen.getByTestId('s').textContent);

describe('useSyncSummary', () => {
  it('is not known without an account', () => {
    mount(null);
    expect(read()).toEqual({ known: false, total: 0, conflicts: 0, error: null, last: null });
  });

  it('reads unsaved changes, conflicts across profiles, the first error and the last sync', async () => {
    const { sync } = mkSync();
    mount(sync);
    await waitFor(() => expect(read().known).toBe(true));
    expect(read()).toEqual({ known: true, total: 3, conflicts: 3, error: 'boom', last: 5 });
  });

  it('is not known when the sync cannot count (an older engine)', async () => {
    const { sync } = mkSync({ unsaved: undefined });
    mount(sync);
    await waitFor(() => expect(sync.status).toHaveBeenCalled());
    expect(read().known).toBe(false);
  });

  it('reads again when a pull applies something, a conflict arrives, an error is reported, or something asks', async () => {
    const { sync, cbs } = mkSync();
    mount(sync);
    await waitFor(() => expect(read().total).toBe(3));
    sync.unsaved.mockResolvedValue({ profiles: {}, unattributed: 0, total: 0 });
    await act(async () => { cbs.applied({ applied: 1 }); });
    await waitFor(() => expect(read().total).toBe(0));
    sync.unsaved.mockResolvedValue({ profiles: { W: 4 }, unattributed: 0, total: 4 });
    await act(async () => { cbs.conflict({ count: 1 }); });
    await waitFor(() => expect(read().total).toBe(4));
    sync.unsaved.mockResolvedValue({ profiles: { W: 5 }, unattributed: 0, total: 5 });
    await act(async () => { refreshSyncSummary(); });
    await waitFor(() => expect(read().total).toBe(5));
    sync.unsaved.mockResolvedValue({ profiles: { W: 6 }, unattributed: 0, total: 6 });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(read().total).toBe(6));
  });

  it('keeps the last answer when reading fails', async () => {
    const { sync } = mkSync();
    mount(sync);
    await waitFor(() => expect(read().total).toBe(3));
    sync.unsaved.mockRejectedValue(new Error('offline'));
    await act(async () => { refreshSyncSummary(); });
    expect(read().total).toBe(3);
  });

  it('polls on its interval and stops when it goes away', async () => {
    vi.useFakeTimers();
    try {
      const { sync } = mkSync();
      const { unmount } = mount(sync, { pollMs: 1000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      const before = sync.unsaved.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(sync.unsaved.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
      unmount();
      const after = sync.unsaved.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(sync.unsaved.mock.calls.length).toBe(after);
    } finally { vi.useRealTimers(); }
  });
});
