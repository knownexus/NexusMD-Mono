import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountGate, useAccount } from './account-gate.jsx';

const CK_B64 = btoa('a'.repeat(32));
const SESSION = { username: 'ann', userId: 'u1', role: 'user', containerKey: CK_B64, refreshToken: 'r' };
const CK = { raw: new Uint8Array(32) };
const err = (code) => Object.assign(new Error(code), { name: 'AccountError', code });

let errorCb;
const mkSync = (over = {}) => ({
  start: vi.fn(), stop: vi.fn(), observe: vi.fn(),
  pull: vi.fn(async () => ({ applied: 1 })),
  seed: vi.fn(async () => ({ pushed: 1 })),
  snapshot: vi.fn(async () => new Map()),
  onApplied: vi.fn(() => () => {}),
  onError: vi.fn((cb) => { errorCb = cb; return () => {}; }),
  ...over,
});
const mkClient = (over = {}) => ({
  status: vi.fn(async () => ({ needsSetup: false })),
  getSession: vi.fn(async () => null),
  login: vi.fn(async () => ({ session: SESSION, containerKey: CK })),
  setup: vi.fn(async () => ({ session: { ...SESSION, role: 'admin' }, containerKey: CK })),
  redeem: vi.fn(async () => ({ session: SESSION, containerKey: CK })),
  logout: vi.fn(async () => {}),
  listDevices: vi.fn(async () => [{ id: 'd1', name: 'Laptop', platform: 'windows' }]),
  createDevice: vi.fn(async ({ name }) => ({ id: 'dnew', name })),
  getChanges: vi.fn(async () => ({ items: [{ id: 'x' }], cursor: 1, hasMore: false })),
  ...over,
});
let deviceId;
let sync;
const mkAccount = (clientOver, syncOver) => {
  sync = mkSync(syncOver);
  return {
    client: mkClient(clientOver),
    sessionStore: {},
    deviceStore: { get: vi.fn(() => deviceId), set: vi.fn((id) => { deviceId = id; }) },
    createSync: vi.fn(() => sync),
    platform: 'windows',
    deviceNameDefault: () => 'My PC',
    optOutKey: 'test.optout',
  };
};
const mount = (account) => render(<AccountGate account={account}><div>shell</div></AccountGate>);
const signIn = async (user = 'ann', pw = 'secret') => {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: user } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

beforeEach(() => {
  localStorage.clear();
  deviceId = null; errorCb = null;
  Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, configurable: true });
});

describe('AccountGate', () => {
  it('wrong password shows the invalid message and no device picker', async () => {
    const a = mkAccount({ login: vi.fn(async () => { throw err('invalid'); }) });
    mount(a);
    await signIn();
    expect(await screen.findByText('Username or password is incorrect.')).toBeTruthy();
    expect(screen.queryByText('This is a new device')).toBeNull();
    expect(screen.getByLabelText('Password').value).toBe('');
  });

  it('shows the lock message when locked', async () => {
    mount(mkAccount({ login: vi.fn(async () => { throw err('locked'); }) }));
    await signIn();
    expect(await screen.findByText(/locked/i)).toBeTruthy();
  });

  it('uses password inputs', async () => {
    mount(mkAccount());
    expect((await screen.findByLabelText('Password')).type).toBe('password');
  });

  it('login lists devices; picking one stores it, pulls, then reloads', async () => {
    const a = mkAccount();
    mount(a);
    await signIn();
    fireEvent.click(await screen.findByLabelText(/Laptop/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(a.deviceStore.set).toHaveBeenCalledWith('d1');
    expect(a.createSync).toHaveBeenCalledWith(CK, 'd1');
    expect(sync.pull).toHaveBeenCalled();
    expect(a.client.createDevice).not.toHaveBeenCalled();
  });

  it('a new device is created first, named from deviceNameDefault', async () => {
    const a = mkAccount();
    mount(a);
    await signIn();
    fireEvent.click(await screen.findByLabelText('This is a new device'));
    expect(screen.getByLabelText('Device name').value).toBe('My PC');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(a.client.createDevice).toHaveBeenCalledWith({ name: 'My PC', platform: 'windows' });
    expect(a.deviceStore.set).toHaveBeenCalledWith('dnew');
  });

  it('offers to upload local settings to an empty account and seeds', async () => {
    const a = mkAccount(
      { listDevices: vi.fn(async () => []), getChanges: vi.fn(async () => ({ items: [], cursor: 0, hasMore: false })) },
      { snapshot: vi.fn(async () => new Map([['a', {}]])) },
    );
    mount(a);
    await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: "Upload this device's settings" }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(sync.seed).toHaveBeenCalled();
    expect(sync.pull).not.toHaveBeenCalled();
  });

  it('stored session and device render children without a network call', async () => {
    deviceId = 'd1';
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(a.client.status).not.toHaveBeenCalled();
    expect(a.client.listDevices).not.toHaveBeenCalled();
    expect(sync.start).toHaveBeenCalledTimes(1);
  });

  it('an expired session shows the login screen and keeps local data', async () => {
    deviceId = 'd1';
    localStorage.setItem('keepme', '1');
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
    mount(a);
    await screen.findByText('shell');
    errorCb({ code: 'session-expired' });
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(screen.queryByText('shell')).toBeNull();
    expect(sync.stop).toHaveBeenCalled();
    expect(localStorage.getItem('keepme')).toBe('1');
  });

  it('use without an account renders children and remembers the choice', async () => {
    const a = mkAccount();
    mount(a);
    fireEvent.click(await screen.findByRole('button', { name: 'Use without an account' }));
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(localStorage.getItem('test.optout')).toBe('1');
    expect(a.createSync).not.toHaveBeenCalled();
  });

  it('an opted-out device renders children immediately', async () => {
    localStorage.setItem('test.optout', '1');
    const a = mkAccount();
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(a.client.status).not.toHaveBeenCalled();
  });

  it('first run shows setup and creates the admin', async () => {
    const a = mkAccount({ status: vi.fn(async () => ({ needsSetup: true })) });
    mount(a);
    fireEvent.change(await screen.findByLabelText('Setup token'), { target: { value: 'tok' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'root' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'pw2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(a.client.setup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'pw1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(a.client.setup).toHaveBeenCalledWith({ setupToken: 'tok', username: 'root', password: 'pw1' }));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('redeems an invite from the second tab', async () => {
    const a = mkAccount();
    mount(a);
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem an invite' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(a.client.redeem).toHaveBeenCalledWith({ inviteCode: 'abc', username: 'bob', password: 'pw' }));
  });

  it('signs out through useAccount: stops sync, logs out, shows login', async () => {
    deviceId = 'd1';
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
    const Probe = () => { const x = useAccount(); return <button onClick={x.signOut}>out {x.session?.username}</button>; };
    render(<AccountGate account={a}><Probe /></AccountGate>);
    fireEvent.click(await screen.findByRole('button', { name: 'out ann' }));
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(a.client.logout).toHaveBeenCalled();
    expect(sync.stop).toHaveBeenCalled();
  });
});
