// account-card.jsx — Settings card for the signed-in NexusMD account: sync status, devices,
// change password, log out, and (admins) invites and users. Reads the sync/session from the
// surrounding AccountGate via useAccount().
import React from 'react';
import { VsCard, VsRow, VsFullRow } from './views/view-settings.jsx';
import { useAccount, accountErrorMessage } from './account-gate.jsx';
import { rendererLog, ignore } from '@nexusmd/core'

const log = rendererLog('account', 'card')

const { useState, useEffect, useCallback } = React;

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : 'never');

function Msg({ text }) {
  return text ? <div className="profile-setup__error" role="alert" style={{ fontSize: 12.5 }}>{text}</div> : null;
}

function PasswordForm({ client }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setOk(false);
    if (next !== confirm) { setCur(''); setNext(''); setConfirm(''); setMsg('Passwords do not match.'); return; }
    const args = { currentPassword: cur, newPassword: next };
    setCur(''); setNext(''); setConfirm('');
    setBusy(true); setMsg('');
    try {
      await client.changePassword(args);
      setOk(true);
    } catch (err) {
      setMsg(accountErrorMessage(err));
    } finally { setBusy(false); }
  };

  const field = (label, value, set) => (
    <label className="profile-setup__label">{label}
      <input className="profile-setup__input" type="password" autoComplete="off" value={value}
        onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
      {field('Current password', cur, setCur)}
      {field('New password', next, setNext)}
      {field('Confirm new password', confirm, setConfirm)}
      <Msg text={msg} />
      {ok && <div style={{ fontSize: 12.5 }}>Password changed.</div>}
      <div><button type="submit" className="btn sm" disabled={busy || !cur || !next}>Change password</button></div>
    </form>
  );
}

function Devices({ client, currentId }) {
  const [devices, setDevices] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name }
  const [removing, setRemoving] = useState(null); // id awaiting confirmation; the current device has no Remove
  const [msg, setMsg] = useState('');

  const load = useCallback(() => client.listDevices().then(setDevices, (e) => { setDevices([]); setMsg(accountErrorMessage(e)); }), [client]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setMsg('');
    try { await fn(); await load(); } catch (e) { setMsg(accountErrorMessage(e)); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {(devices || []).map((d) => (
        <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {editing && editing.id === d.id ? (
            <>
              <label className="profile-setup__label" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Device name
                <input className="profile-setup__input" value={editing.name}
                  onChange={(e) => setEditing({ id: d.id, name: e.target.value })} />
              </label>
              <button className="btn sm" disabled={!editing.name.trim()}
                onClick={() => act(async () => { await client.renameDevice(d.id, editing.name.trim()); setEditing(null); })}>Save</button>
              <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
            </>
          ) : (
            <>
              <span>{d.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {d.platform}{d.id === currentId ? ' (this device)' : ''}
              </span>
              <button className="btn sm ghost" aria-label={`Rename ${d.name}`} onClick={() => setEditing({ id: d.id, name: d.name })}>Rename</button>
              {d.id !== currentId && (removing === d.id ? (
                <>
                  <span style={{ fontSize: 12.5 }}>
                    Remove {d.name}? If it is still in use it stops syncing and asks which device it is next time.
                  </span>
                  <button className="btn sm" aria-label={`Confirm remove ${d.name}`}
                    onClick={() => { setRemoving(null); act(() => client.deleteDevice(d.id)); }}>Remove</button>
                  <button className="btn sm ghost" aria-label={`Keep ${d.name}`} onClick={() => setRemoving(null)}>Cancel</button>
                </>
              ) : (
                <button className="btn sm ghost" aria-label={`Remove ${d.name}`} onClick={() => setRemoving(d.id)}>Remove</button>
              ))}
            </>
          )}
        </div>
      ))}
      <Msg text={msg} />
    </div>
  );
}

function Admin({ client }) {
  const [users, setUsers] = useState([]);
  const [invite, setInvite] = useState(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => client.listUsers().then(setUsers, (e) => setMsg(accountErrorMessage(e))), [client]);
  useEffect(() => { load(); }, [load]);

  const createInvite = async () => {
    setMsg('');
    try { setInvite(await client.createInvite({})); } catch (e) { setMsg(accountErrorMessage(e)); }
  };
  const toggle = async (u) => {
    setMsg('');
    try { await client.setUserDisabled(u.id, !u.disabled); await load(); } catch (e) { setMsg(accountErrorMessage(e)); }
  };

  return (
    <>
      <VsFullRow title="Invites" desc="Create a one-time code for a new user. It is shown only once.">
        <button className="btn sm" onClick={createInvite}>Create invite</button>
        {invite && (
          <div style={{ marginTop: 8 }}>
            <code>{invite.code}</code>{' '}
            <button className="btn sm ghost" onClick={() => setInvite(null)}>Done</button>
          </div>
        )}
      </VsFullRow>
      <VsFullRow title="Users">
        {users.map((u) => (
          <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{u.username}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.role}{u.disabled ? ', disabled' : ''}</span>
            <button className="btn sm ghost" aria-label={`${u.disabled ? 'Enable' : 'Disable'} ${u.username}`} onClick={() => toggle(u)}>
              {u.disabled ? 'Enable' : 'Disable'}
            </button>
          </div>
        ))}
        <Msg text={msg} />
      </VsFullRow>
    </>
  );
}

/**
 * Settings card for the signed-in account. Render it in the shell's Data & sync settings (desktop)
 * or through the `accountSlot` prop of BackupRestoreCard (Android). Needs an AccountGate above it.
 * @param {{ account: { client: object, deviceStore: { get(): string|null }, optOutKey: string } }} props
 */
export function AccountCard({ account }) {
  const { sync, session, signOut, serverName } = useAccount();
  const { client, deviceStore, optOutKey } = account;
  const last = sync ? sync.lastSyncAt() : null;

  if (!session) {
    return (
      <VsCard title="Account" icon="lock" flush={false}>
        <VsRow title="Not signed in" desc="Sign in to sync your settings across devices.">
          <button className="btn sm" onClick={() => { try { localStorage.removeItem(optOutKey); } catch (err) { ignore(log, 'browser storage is unavailable', err, 'debug') } window.location.reload(); }}>
            Sign in
          </button>
        </VsRow>
      </VsCard>
    );
  }

  return (
    <VsCard title="Account" icon="lock" flush={false}>
      <VsRow title={`Signed in as ${session.username}`} desc={`${session.role === 'admin' ? 'Administrator. ' : ''}${serverName ? `Server: ${serverName}. ` : ''}Last synced: ${fmtTime(last)}. Save and Load for each profile are under Profile sync.`}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={signOut}>Log out</button>
        </div>
      </VsRow>
      <VsFullRow title="Devices" desc="Devices that sync with this account."><Devices client={client} currentId={deviceStore.get()} /></VsFullRow>
      <VsFullRow title="Change password" desc="Your other sessions are signed out."><PasswordForm client={client} /></VsFullRow>
      {session.role === 'admin' && <Admin client={client} />}
    </VsCard>
  );
}
