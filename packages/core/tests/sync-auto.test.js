import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startAutoSync } from '../src/index.js';

describe('startAutoSync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('(a) calls syncNow once per interval tick', () => {
    const syncNow = vi.fn().mockResolvedValue({});
    const stop = startAutoSync({ syncNow, intervalMs: 1000 });

    expect(syncNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(syncNow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(syncNow).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(syncNow).toHaveBeenCalledTimes(3);

    stop();
  });

  it('(b) debounces change events — 3 fires within window → exactly 1 syncNow', () => {
    const syncNow = vi.fn().mockResolvedValue({});
    let changeCb;
    const unsubChange = vi.fn();
    const subscribeChange = cb => { changeCb = cb; return unsubChange; };

    const stop = startAutoSync({ syncNow, intervalMs: 60000, subscribeChange, debounceMs: 500 });

    changeCb();
    changeCb();
    changeCb();

    expect(syncNow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(syncNow).toHaveBeenCalledTimes(1);

    // Advancing further does not produce more calls
    vi.advanceTimersByTime(1000);
    expect(syncNow).toHaveBeenCalledTimes(1);

    stop();
  });

  it('(c) foreground event triggers syncNow immediately (no debounce)', () => {
    const syncNow = vi.fn().mockResolvedValue({});
    let fgCb;
    const unsubFg = vi.fn();
    const subscribeForeground = cb => { fgCb = cb; return unsubFg; };

    const stop = startAutoSync({ syncNow, intervalMs: 60000, subscribeForeground });

    expect(syncNow).not.toHaveBeenCalled();
    fgCb();
    expect(syncNow).toHaveBeenCalledTimes(1);
    fgCb();
    expect(syncNow).toHaveBeenCalledTimes(2);

    stop();
  });

  it('(d) stop() clears interval + pending debounce, calls unsubscribes, prevents further syncNow', () => {
    const syncNow = vi.fn().mockResolvedValue({});
    const unsubChange = vi.fn();
    const unsubFg = vi.fn();
    let changeCb;
    let fgCb;
    const subscribeChange = cb => { changeCb = cb; return unsubChange; };
    const subscribeForeground = cb => { fgCb = cb; return unsubFg; };

    const stop = startAutoSync({ syncNow, intervalMs: 1000, subscribeChange, subscribeForeground, debounceMs: 500 });

    // Arm a pending debounce
    changeCb();

    // Stop before debounce fires
    stop();

    expect(unsubChange).toHaveBeenCalledTimes(1);
    expect(unsubFg).toHaveBeenCalledTimes(1);

    // Timers advancing must not fire anything
    vi.advanceTimersByTime(5000);
    expect(syncNow).not.toHaveBeenCalled();

    // Firing cbs after stop must also be inert
    fgCb();
    changeCb();
    vi.advanceTimersByTime(5000);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('swallows syncNow rejections — never throws into a timer callback', () => {
    const syncNow = vi.fn().mockRejectedValue(new Error('network error'));
    const stop = startAutoSync({ syncNow, intervalMs: 1000 });

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(syncNow).toHaveBeenCalledTimes(1);

    stop();
  });
});
