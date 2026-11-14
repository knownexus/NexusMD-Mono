import { describe, it, expect, vi, afterEach } from 'vitest';
import { openSettings, takePendingSettingsTab, OPEN_SETTINGS_EVENT } from './open-settings.js';
import { toast, NexusMDToastBus, ToastHost } from './toast.jsx';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(async () => { vi.useRealTimers(); await flush(); takePendingSettingsTab(); await flush(); cleanup(); });

describe('openSettings', () => {
  it('announces the tab on the window', async () => {
    const heard = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, heard);
    openSettings('data');
    window.removeEventListener(OPEN_SETTINGS_EVENT, heard);
    expect(heard.mock.calls[0][0].detail).toEqual({ tab: 'data' });
  });

  it('holds the tab for a Settings screen that mounts afterwards, and gives the same answer twice in one turn', async () => {
    openSettings('data');
    expect(takePendingSettingsTab()).toBe('data');
    expect(takePendingSettingsTab()).toBe('data'); // React's double initializer in development
    await flush();
    expect(takePendingSettingsTab()).toBeNull(); // used up
  });

  it('forgets a request nobody picked up after a few seconds', () => {
    vi.useFakeTimers();
    openSettings('data');
    vi.advanceTimersByTime(6000);
    expect(takePendingSettingsTab()).toBeNull();
  });

  it('with no tab it asks for none', () => {
    openSettings();
    expect(takePendingSettingsTab()).toBeNull();
    openSettings(42);
    expect(takePendingSettingsTab()).toBeNull();
  });
});

describe('toast with an action', () => {
  it('shows a button that runs the action and closes the toast', () => {
    const onClick = vi.fn();
    render(<ToastHost />);
    act(() => { toast('3 sync conflicts need your decision', 'info', { action: { label: 'Review', onClick } }); });
    expect(screen.getByText('3 sync conflicts need your decision')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('3 sync conflicts need your decision')).toBeNull();
  });

  it('stays longer than a plain toast, and ignores an action that is not a button label and a function', () => {
    const seen = [];
    const off = NexusMDToastBus.subscribe((e) => seen.push(e));
    toast('plain');
    toast('with', 'info', { action: { label: 'Go', onClick: () => {} } });
    toast('broken', 'info', { action: { label: 'Go' } });
    toast('broken2', 'info', { action: { onClick: () => {} } });
    off();
    expect(seen.map((e) => [e.message, e.duration, !!e.action])).toEqual([
      ['plain', 4500, false], ['with', 9000, true], ['broken', 4500, false], ['broken2', 4500, false],
    ]);
  });
});
