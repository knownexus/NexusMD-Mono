import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AccountGate, useAccount } from './account-gate.jsx';
const toasts = vi.hoisted(() => []);
const toastOpts = vi.hoisted(() => []);
vi.mock('./toast.jsx', async (orig) => ({ ...(await orig()), toast: (msg, type, opts) => { toasts.push([type, msg]); toastOpts.push(opts); } }));

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

  it('shows the update message when the client is outdated', async () => {
    mount(mkAccount({ login: vi.fn(async () => { throw err('client-outdated'); }) }));
    await signIn();
    expect(await screen.findByText('This version of NexusMD can no longer sync. Update NexusMD to keep syncing.')).toBeTruthy();
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

  describe('an empty account and a device with local settings', () => {
    const emptyAccount = () => {
      const a = mkAccount(
        { listDevices: vi.fn(async () => []), getChanges: vi.fn(async () => ({ items: [], cursor: 0, hasMore: false })) },
        { snapshot: vi.fn(async () => new Map([['a', {}]])) },
      );
      a.boundUserKey = 'test.bound';
      a.clearLocal = vi.fn(async () => {});
      return a;
    };

    it('says the settings will be uploaded, with no "Not now"; Continue seeds', async () => {
      const a = emptyAccount();
      mount(a);
      await signIn();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(await screen.findByText(/settings will be uploaded to your account/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
      expect(sync.seed).toHaveBeenCalled();
      expect(sync.pull).not.toHaveBeenCalled();
    });

    it('Cancel signs out and uploads nothing', async () => {
      const a = emptyAccount();
      mount(a);
      await signIn();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }));
      expect(await screen.findByLabelText('Username')).toBeTruthy();
      expect(a.client.logout).toHaveBeenCalled();
      expect(sync.seed).not.toHaveBeenCalled();
      expect(sync.pull).not.toHaveBeenCalled();
      expect(sync.start).not.toHaveBeenCalled();
      expect(deviceId).toBeNull();
      expect(localStorage.getItem('test.bound')).toBeNull(); // nothing of this account is on the device
      expect(window.location.reload).not.toHaveBeenCalled();
    });
  });

  it('a failed restore after the device pick still binds the install to the user', async () => {
    localStorage.setItem('keep', '1');
    const a = mkAccount({}, { pull: vi.fn(async () => ({ error: err('offline') })) });
    a.boundUserKey = 'test.bound';
    a.clearLocal = vi.fn(async () => {});
    const first = mount(a);
    await signIn();
    fireEvent.click(await screen.findByLabelText(/Laptop/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
    expect(deviceId).toBe('d1');
    expect(localStorage.getItem('test.bound')).toBe('u1');
    first.unmount();
    // later, another user signs in on this install: the switch warning appears
    a.client.login = vi.fn(async () => ({ session: { ...SESSION, userId: 'u2', username: 'bob' }, containerKey: CK }));
    mount(a);
    await signIn('bob', 'pw');
    expect(await screen.findByText(/settings from another account/)).toBeTruthy();
  });

  describe('boundUserKey without clearLocal fails closed', () => {
    it('a different user at sign-in is refused, not synced', async () => {
      localStorage.setItem('test.bound', 'someone-else');
      const a = mkAccount();
      a.boundUserKey = 'test.bound';
      mount(a);
      await signIn();
      expect(await screen.findByText(/settings from another account/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
      expect(screen.queryByLabelText('This is a new device')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(await screen.findByLabelText('Username')).toBeTruthy();
      expect(a.client.logout).toHaveBeenCalled();
      expect(a.createSync).not.toHaveBeenCalled();
      expect(localStorage.getItem('test.bound')).toBe('someone-else');
    });

    it('a different user in the stored session at boot is refused, not synced', async () => {
      deviceId = 'olddev';
      localStorage.setItem('test.bound', 'uA');
      const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
      a.boundUserKey = 'test.bound';
      mount(a);
      expect(await screen.findByText(/settings from another account/)).toBeTruthy();
      expect(screen.queryByText('shell')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
      expect(a.createSync).not.toHaveBeenCalled();
    });
  });

  it('a device removed from the account stops sync, forgets the device id and shows the picker', async () => {
    deviceId = 'd9';
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
    mount(a);
    await screen.findByText('shell');
    errorCb(err('not-found'));
    expect(await screen.findByText(/removed from your account/)).toBeTruthy();
    expect(screen.queryByText('shell')).toBeNull();
    expect(sync.stop).toHaveBeenCalled();
    expect(a.deviceStore.set).toHaveBeenCalledWith(null);
    fireEvent.click(await screen.findByLabelText(/Laptop/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(a.deviceStore.set).toHaveBeenLastCalledWith('d1');
    expect(a.createSync).toHaveBeenLastCalledWith(expect.anything(), 'd1');
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

  it('a rejected invite says the invite is the problem, not the password', async () => {
    const a = mkAccount({ redeem: vi.fn(async () => { throw Object.assign(err('invalid-invite'), { status: 400 }); }) });
    mount(a);
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem an invite' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This invite code is invalid, expired or already used.')).toBeTruthy();
    expect(screen.queryByText('Username or password is incorrect.')).toBeNull();
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

  it('re-login by the same user after expiry returns to the app without the picker', async () => {
    deviceId = 'd1';
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) });
    mount(a);
    await screen.findByText('shell');
    errorCb({ code: 'session-expired' });
    await signIn();
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(a.client.listDevices).not.toHaveBeenCalled();
  });

  it('a different user after expiry goes through the device picker', async () => {
    deviceId = 'd1';
    const a = mkAccount({
      getSession: vi.fn(async () => SESSION),
      login: vi.fn(async () => ({ session: { ...SESSION, userId: 'u2', username: 'bob' }, containerKey: CK })),
    });
    mount(a);
    await screen.findByText('shell');
    errorCb({ code: 'session-expired' });
    await signIn('bob', 'pw');
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByText('shell')).toBeNull();
  });

  it('retrying Continue reuses the device created by the failed attempt', async () => {
    const a = mkAccount({
      listDevices: vi.fn(async () => []),
      getChanges: vi.fn().mockRejectedValueOnce(err('offline')).mockResolvedValue({ items: [{ id: 'x' }] }),
    });
    mount(a);
    await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    expect(a.client.createDevice).toHaveBeenCalledTimes(1);
  });

  describe('switching accounts on one install', () => {
    const withBinding = (bound, clientOver) => {
      if (bound) localStorage.setItem('test.bound', bound);
      const a = mkAccount(clientOver);
      a.boundUserKey = 'test.bound';
      a.clearLocal = vi.fn(async () => {});
      a.deviceStore.set = vi.fn((id) => { deviceId = id; });
      return a;
    };

    it('warns when a different user signs in; Continue clears local data and the device id, then shows the picker', async () => {
      deviceId = 'olddev';
      const a = withBinding('someone-else');
      mount(a);
      await signIn();
      expect(await screen.findByText(/settings from another account/)).toBeTruthy();
      expect(screen.getByText(/Continue as ann/)).toBeTruthy();
      expect(a.clearLocal).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByLabelText('This is a new device')).toBeTruthy();
      expect(a.clearLocal).toHaveBeenCalledTimes(1);
      expect(a.deviceStore.set).toHaveBeenCalledWith(null);
      expect(localStorage.getItem('test.bound')).toBeNull();
    });

    it('account switch with nothing unsynced clears content too', async () => {
      const a = withBinding('someone-else');
      a.unpushed = vi.fn(async () => []);
      mount(a);
      await signIn();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(await screen.findByLabelText('This is a new device')).toBeTruthy();
      expect(a.unpushed).toHaveBeenCalled();
      expect(a.clearLocal).toHaveBeenCalledTimes(1);
    });

    describe('with unsynced content', () => {
      const UNSYNCED = [
        { id: 'nexusmd:p.W.md_documents#d1', profileId: 'W' },
        { id: 'nexusmd:p.W.lists#l1', profileId: 'W' },
        { id: 'p.H.ado.org', profileId: 'H' },
      ];
      const blocked = () => {
        const a = withBinding('someone-else');
        a.unpushed = vi.fn(async () => UNSYNCED);
        a.exportBackup = vi.fn(async () => true);
        return a;
      };

      it('is blocked and lists the profiles with what is not synced; no Continue', async () => {
        const a = blocked();
        mount(a);
        await signIn();
        expect(await screen.findByText(/not been synced/)).toBeTruthy();
        expect(screen.getByText(/W: 2 items/)).toBeTruthy();
        expect(screen.getByText(/H: 1 item\b/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
        expect(a.clearLocal).not.toHaveBeenCalled();
      });

      it('Cancel and sync first signs out, says what to do, clears nothing', async () => {
        const a = blocked();
        mount(a);
        await signIn();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel and sync first' }));
        expect(await screen.findByText(/Sign in with the account this device belongs to/)).toBeTruthy();
        expect(a.client.logout).toHaveBeenCalled();
        expect(a.clearLocal).not.toHaveBeenCalled();
        expect(localStorage.getItem('test.bound')).toBe('someone-else');
      });

      it('Export then Continue clears', async () => {
        const a = blocked();
        mount(a);
        await signIn();
        fireEvent.click(await screen.findByRole('button', { name: 'Export a backup' }));
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
        await waitFor(() => expect(a.exportBackup).toHaveBeenCalledWith('pw'));
        fireEvent.click(await screen.findByRole('button', { name: 'Continue and remove' }));
        expect(await screen.findByLabelText('This is a new device')).toBeTruthy();
        expect(a.clearLocal).toHaveBeenCalledTimes(1);
      });

      it('an export that is cancelled keeps the switch blocked', async () => {
        const a = blocked();
        a.exportBackup = vi.fn(async () => false);
        mount(a);
        await signIn();
        fireEvent.click(await screen.findByRole('button', { name: 'Export a backup' }));
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
        await waitFor(() => expect(a.exportBackup).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('button', { name: 'Continue and remove' })).toBeNull();
      });

      it('Cancel clears nothing', async () => {
        const a = blocked();
        mount(a);
        await signIn();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(await screen.findByLabelText('Username')).toBeTruthy();
        expect(a.clearLocal).not.toHaveBeenCalled();
      });

      it('without an export, the only ways out sign out', async () => {
        const a = blocked();
        delete a.exportBackup;
        mount(a);
        await signIn();
        expect(await screen.findByText(/not been synced/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Export a backup' })).toBeNull();
      });
    });

    it('Cancel logs out and returns to the login screen without clearing', async () => {
      const a = withBinding('someone-else');
      mount(a);
      await signIn();
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByLabelText('Username')).toBeTruthy();
      expect(a.client.logout).toHaveBeenCalled();
      expect(a.clearLocal).not.toHaveBeenCalled();
      expect(localStorage.getItem('test.bound')).toBe('someone-else');
    });

    it('the same user skips the warning', async () => {
      const a = withBinding('u1');
      mount(a);
      await signIn();
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
      expect(screen.queryByText(/settings from another account/)).toBeNull();
    });

    it('no bound user (first account on this install) skips the warning', async () => {
      const a = withBinding(null);
      mount(a);
      await signIn();
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
      expect(screen.queryByText(/settings from another account/)).toBeNull();
    });

    it('records the user id after a device is picked', async () => {
      const a = withBinding(null);
      mount(a);
      await signIn();
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(window.location.reload).toHaveBeenCalled());
      expect(localStorage.getItem('test.bound')).toBe('u1');
    });
  });

  describe('restart with a stored session', () => {
    const boot = (bound, clearLocal) => {
      deviceId = 'olddev';
      if (bound) localStorage.setItem('test.bound', bound);
      const a = mkAccount({ getSession: vi.fn(async () => ({ ...SESSION, userId: 'uB', username: 'bea' })) });
      a.boundUserKey = 'test.bound';
      a.clearLocal = clearLocal || vi.fn(async () => {});
      return a;
    };

    it('shows the switch warning, not the app, when the bound user differs; no sync is created', async () => {
      const a = boot('uA');
      mount(a);
      expect(await screen.findByText(/Continue as bea/)).toBeTruthy();
      expect(screen.queryByText('shell')).toBeNull();
      expect(a.createSync).not.toHaveBeenCalled();
      expect(sync.start).not.toHaveBeenCalled();
    });

    it('lands on the warning again after a clearLocal failure and restart', async () => {
      const a = boot('uA', vi.fn(async () => { throw new Error('disk'); }));
      const first = mount(a);
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(await screen.findByText('disk')).toBeTruthy();
      expect(localStorage.getItem('test.bound')).toBe('uA');
      expect(a.deviceStore.set).not.toHaveBeenCalled();
      first.unmount();
      mount(a);
      expect(await screen.findByText(/Continue as bea/)).toBeTruthy();
      expect(a.createSync).not.toHaveBeenCalled();
    });

    it('Cancel from the boot-time warning logs out without clearing', async () => {
      const a = boot('uA');
      mount(a);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByLabelText('Username')).toBeTruthy();
      expect(a.client.logout).toHaveBeenCalled();
      expect(a.clearLocal).not.toHaveBeenCalled();
    });

    it('a matching bound user renders the app as before', async () => {
      const a = boot('uB');
      mount(a);
      expect(await screen.findByText('shell')).toBeTruthy();
      expect(sync.start).toHaveBeenCalledTimes(1);
    });

    it('no bound user renders the app as before', async () => {
      const a = boot(null);
      mount(a);
      expect(await screen.findByText('shell')).toBeTruthy();
    });
  });
});

describe('AccountGate pending purge', () => {
  const PENDING = [{ pid: 'W', name: 'Work', unpushed: ['nexusmd:p.W.md_documents#d1', 'p.W.ado.org'] }];
  const ready = (over = {}) => {
    deviceId = 'd1';
    let pendingCb = null;
    const pending = [...PENDING];
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) }, {
      pendingPurges: vi.fn(() => [...pending]),
      onPendingPurge: vi.fn((cb) => { pendingCb = cb; return () => {}; }),
      confirmPurge: vi.fn(async (pid) => { pending.splice(pending.findIndex(p => p.pid === pid), 1); return {}; }),
      ...over,
    });
    a.exportBackup = vi.fn(async () => true);
    return { a, fire: () => pendingCb && pendingCb({ count: pending.length }) };
  };

  it('a pending purge shows the names of discarded items and offers Export first, then Discard', async () => {
    const { a } = ready();
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(await screen.findByText(/Work was deleted for good on another device/)).toBeTruthy();
    expect(screen.getByText('md_documents d1')).toBeTruthy();
    expect(screen.getByText('ado.org')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export first' }));
    fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save backup' }));
    await waitFor(() => expect(a.exportBackup).toHaveBeenCalledWith('pw', 'W'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(sync.confirmPurge).toHaveBeenCalledWith('W'));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/Work was deleted for good/)).toBeNull());
    confirm.mockRestore();
  });

  it('Discard asks for confirmation; Later keeps the data and hides the notice', async () => {
    const { a, fire } = ready();
    mount(a);
    await screen.findByText(/Work was deleted for good/);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(sync.confirmPurge).not.toHaveBeenCalled();
    confirm.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/Work was deleted for good/)).toBeNull();
    // a new pending purge brings it back
    await React.act(async () => { fire(); });
    expect(await screen.findByText(/Work was deleted for good/)).toBeTruthy();
  });

  it('no pending purge, no notice', async () => {
    const { a } = ready({ pendingPurges: vi.fn(() => []) });
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    expect(screen.queryByText(/deleted for good/)).toBeNull();
  });
});

describe('AccountGate conflicts', () => {
  it('a growing conflict queue raises a toast pointing to Data & sync', async () => {
    deviceId = 'd1';
    toasts.length = 0;
    let cb = null;
    const a = mkAccount({ getSession: vi.fn(async () => SESSION) }, { onConflict: vi.fn((f) => { cb = f; return () => {}; }) });
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    await React.act(async () => { cb({ count: 2 }); });
    expect(toasts).toContainEqual(['info', '2 sync conflicts need your decision — Settings › Data & sync']);
    await React.act(async () => { cb({ count: 1 }); });
    expect(toasts).toContainEqual(['info', '1 sync conflict needs your decision — Settings › Data & sync']);
  });

  it('the conflict notice gets a Review button when the app can open Data & sync, and none when it cannot', async () => {
    deviceId = 'd1';
    toasts.length = 0; toastOpts.length = 0;
    let cb = null;
    const review = vi.fn();
    const a = { ...mkAccount({ getSession: vi.fn(async () => SESSION) }, { onConflict: vi.fn((f) => { cb = f; return () => {}; }) }), reviewConflicts: review };
    mount(a);
    expect(await screen.findByText('shell')).toBeTruthy();
    await React.act(async () => { cb({ count: 2 }); });
    expect(toastOpts.at(-1).action.label).toBe('Review');
    toastOpts.at(-1).action.onClick();
    expect(review).toHaveBeenCalledTimes(1);
    cleanup();
    toastOpts.length = 0;
    const b = mkAccount({ getSession: vi.fn(async () => SESSION) }, { onConflict: vi.fn((f) => { cb = f; return () => {}; }) });
    mount(b);
    expect(await screen.findByText('shell')).toBeTruthy();
    await React.act(async () => { cb({ count: 1 }); });
    expect(toastOpts.at(-1)).toBeUndefined();
  });
});

