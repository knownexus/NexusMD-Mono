import { describe, it, expect, vi } from 'vitest';
import { singleFlight } from '../src/index.js';

describe('singleFlight', () => {
  it('coalesces concurrent calls and clears after settle', async () => {
    let resolve; let calls = 0;
    const inner = vi.fn(() => { calls++; return new Promise(r => { resolve = r; }); });
    const wrapped = singleFlight(inner);

    const p1 = wrapped();                 // starts the in-flight call (calls=1)
    const second = await wrapped();        // concurrent → skipped, inner not re-invoked
    expect(second).toEqual({ skipped: 'in-flight' });
    expect(calls).toBe(1);

    resolve('ok');
    expect(await p1).toBe('ok');

    const p3 = wrapped();                   // guard cleared → inner runs again (synchronously to first await)
    expect(calls).toBe(2);
    resolve('ok2');                         // settle the third call so it doesn't hang
    expect(await p3).toBe('ok2');
  });

  it('clears the guard even when the in-flight call rejects', async () => {
    let reject; let calls = 0;
    const inner = () => { calls++; return new Promise((_, rej) => { reject = rej; }); };
    const wrapped = singleFlight(inner);

    const p1 = wrapped().catch(() => 'caught');
    reject(new Error('boom'));
    expect(await p1).toBe('caught');

    const p2 = wrapped().catch(() => 'caught2'); // not wedged → inner runs again
    expect(calls).toBe(2);
    reject(new Error('boom2'));                   // reject points at the second call now
    expect(await p2).toBe('caught2');
  });
});
