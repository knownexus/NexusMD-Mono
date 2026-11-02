import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountCard } from './account-card.jsx';
import { AccountContext } from './account-gate.jsx';

const mkClient = (over = {}) => ({
  listDevices: vi.fn(async () => [
    { id: 'd1', name: 'Laptop', platform: 'windows' },
    { id: 'd2', name: 'Phone', platform: 'android' },
  ]),
  renameDevice: vi.fn(async () => ({})),
  deleteDevice: vi.fn(async () => ({})),
  changePassword: vi.fn(async () => ({})),
  createInvite: vi.fn(async () => ({ id: 'i1', code: 'SECRET-CODE', expiresAt: 1 })),
  listUsers: vi.fn(async () => [{ id: 'u1', username: 'ann', role: 'admin', disabled: false }, { id: 'u2', username: 'bob', role: 'user', disabled: false }]),
  setUserDisabled: vi.fn(async () => ({})),
  ...over,
});
const mkSync = () => ({ syncNow: vi.fn(async () => ({ applied: 0 })), lastSyncAt: vi.fn(() => 1700000000000) });

const mount = ({ role = 'user', client = mkClient(), sync = mkSync(), signOut = vi.fn() } = {}) => {
  const account = { client, deviceStore: { get: () => 'd1' }, optOutKey: 'o' };
  render(
    <AccountContext.Provider value={{ sync, session: { username: 'ann', role }, signOut }}>
      <AccountCard account={account} />
    </AccountContext.Provider>,
  );
  return { client, sync, signOut };
};

beforeEach(() => localStorage.clear());

describe('AccountCard', () => {
  it('shows status and syncs now', async () => {
    const { sync } = mount();
    expect(screen.getByText(/ann/)).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(sync.syncNow).toHaveBeenCalled());
  });

  it('hides admin sections for non-admins', async () => {
    const { client } = mount({ role: 'user' });
    await screen.findByText('Laptop');
    expect(screen.queryByRole('button', { name: 'Create invite' })).toBeNull();
    expect(screen.queryByText('Users')).toBeNull();
    expect(client.listUsers).not.toHaveBeenCalled();
  });

  it('shows the invite code once after creating one', async () => {
    mount({ role: 'admin' });
    fireEvent.click(await screen.findByRole('button', { name: 'Create invite' }));
    expect(await screen.findByText('SECRET-CODE')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('SECRET-CODE')).toBeNull();
  });

  it('lists users and disables one', async () => {
    const { client } = mount({ role: 'admin' });
    await screen.findByText('bob');
    fireEvent.click(screen.getByRole('button', { name: 'Disable bob' }));
    await waitFor(() => expect(client.setUserDisabled).toHaveBeenCalledWith('u2', true));
  });

  it('renames and removes devices; the current device cannot be removed', async () => {
    const { client } = mount();
    await screen.findByText('Phone');
    expect(screen.queryByRole('button', { name: 'Remove Laptop' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Phone' }));
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'Pixel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.renameDevice).toHaveBeenCalledWith('d2', 'Pixel'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Phone' }));
    await waitFor(() => expect(client.deleteDevice).toHaveBeenCalledWith('d2'));
  });

  it('changes the password with password inputs and clears them', async () => {
    const { client } = mount();
    const cur = await screen.findByLabelText('Current password');
    expect(cur.type).toBe('password');
    fireEvent.change(cur, { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(client.changePassword).toHaveBeenCalledWith({ currentPassword: 'old', newPassword: 'new' }));
    await waitFor(() => expect(screen.getByLabelText('Current password').value).toBe(''));
    expect(screen.getByLabelText('New password').value).toBe('');
  });

  it('shows the wrong-password message when the change fails', async () => {
    const e = Object.assign(new Error('x'), { code: 'invalid' });
    mount({ client: mkClient({ changePassword: vi.fn(async () => { throw e; }) }) });
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'n' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Username or password is incorrect.')).toBeTruthy();
  });

  it('logs out', async () => {
    const { signOut } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
