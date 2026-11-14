// account-gate.jsx — optional sign-in gate for the NexusMD account (settings sync). It sits OUTSIDE
// the profile gate: once an account is signed in (or the user opted out) it renders its children.
// It owns the sync lifecycle: it creates the sync, starts it while children are shown, stops it on
// sign-out/unmount, and reloads the page when a pull changed local data.
import React from 'react';
import { importContainerKey, rendererLog, ignore } from '@nexusmd/core';
import { useProfile } from './profile-context.jsx';
import { toast } from './toast.jsx';
import { appliedAction } from './applied-policy.js';

const { useState, useEffect, useMemo, useCallback, useContext, createContext } = React;

const log = rendererLog('account', 'gate');

const MESSAGES = {
  invalid: 'Username or password is incorrect.',
  'invalid-invite': 'This invite code is invalid, expired or already used.',
  locked: 'Too many failed attempts. This account is locked for a while; try again later.',
  disabled: 'This account has been disabled. Ask an administrator.',
  forbidden: 'That was not accepted. Check the setup token or invite code, or your permissions.',
  conflict: 'That username is already taken.',
  offline: 'Cannot reach the server. Check your connection and try again.',
  'session-expired': 'Your session has expired. Sign in again.',
  'keys-corrupt': 'Your account keys could not be opened. Contact an administrator.',
  server: 'The server had a problem. Try again shortly.',
  'not-found': 'That could not be found.',
  'client-outdated': 'This version of NexusMD can no longer sync. Update NexusMD to keep syncing.',
};

/** Plain-language message for an `AccountError` (or any error). */
export function accountErrorMessage(e) {
  return MESSAGES[e?.code] || e?.message || 'Something went wrong.';
}

/**
 * Account context, provided by AccountGate.
 * @typedef {{ sync: object|null, session: object|null, signOut: () => Promise<void> }} AccountState
 *   `sync` is null when the user opted out or before sign-in; `session` is the stored session.
 */
export const AccountContext = createContext({ sync: null, session: null, signOut: async () => {} });

/**
 * Account state for shells and settings: `{ sync, session, signOut }`. Shells call `sync?.observe()`
 * after settings are saved; the gate has already called `start()`.
 * @returns {AccountState}
 */
export function useAccount() {
  return useContext(AccountContext);
}

function Shell({ children }) {
  return (
    <div className="profile-setup">
      <div className="profile-setup__card">{children}</div>
    </div>
  );
}

function Field({ label, type = 'text', value, onChange, autoFocus }) {
  return (
    <label className="profile-setup__label">{label}
      <input className="profile-setup__input" type={type} value={value} autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'off' : undefined}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Sign in, redeem an invite, or (first run) create the admin. Password fields are cleared after every submit.
function AuthScreen({ client, needsSetup, notice, onAuthed, onOptOut }) {
  const [tab, setTab] = useState('signin');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice || '');
  const mode = needsSetup ? 'setup' : tab === 'redeem' ? 'redeem' : 'signin';

  const submit = async (e) => {
    e.preventDefault();
    if (mode !== 'signin' && password !== confirm) {
      setError('Passwords do not match.');
      setPassword(''); setConfirm('');
      return;
    }
    setBusy(true); setError('');
    const pw = password;
    setPassword(''); setConfirm('');
    try {
      const u = username.trim();
      const r = mode === 'setup' ? await client.setup({ setupToken: code, username: u, password: pw })
        : mode === 'redeem' ? await client.redeem({ inviteCode: code, username: u, password: pw })
          : await client.login({ username: u, password: pw });
      onAuthed(r);
    } catch (err) {
      setError(accountErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h2>{mode === 'setup' ? 'Set up your server' : 'Sign in to NexusMD'}</h2>
      {mode === 'setup' && <p>This server has no accounts yet. Create the administrator account with the setup token.</p>}
      {!needsSetup && (
        <div className="profile-setup__nav">
          <button type="button" className={'profile-setup__type' + (mode === 'signin' ? ' active' : '')}
            onClick={() => setTab('signin')}>I have an account</button>
          <button type="button" className={'profile-setup__type' + (mode === 'redeem' ? ' active' : '')}
            onClick={() => setTab('redeem')}>Redeem an invite</button>
        </div>
      )}
      <form onSubmit={submit} style={{ display: 'contents' }}>
        {mode === 'setup' && <Field label="Setup token" value={code} onChange={setCode} autoFocus />}
        {mode === 'redeem' && <Field label="Invite code" value={code} onChange={setCode} autoFocus />}
        <Field label="Username" value={username} onChange={setUsername} autoFocus={mode === 'signin'} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {mode !== 'signin' && <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} />}
        {error && <p className="profile-setup__error" role="alert">{error}</p>}
        <button type="submit" className="profile-setup__btn" disabled={busy || !username.trim() || !password}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      {!needsSetup && (
        <button type="button" className="profile-setup__type" onClick={onOptOut}>Use without an account</button>
      )}
    </Shell>
  );
}

// Pick a saved device or register this one, then restore (pull) or upload (seed) its settings.
// `onDeviceStored` runs the moment the device id is stored (the gate binds the install to the user
// there, so a failed restore never leaves an unbound install); `onCancel` signs out from the upload
// screen without uploading anything.
function DeviceScreen({ account, auth, notice, onDeviceStored, onCancel, onDone }) {
  const { client, deviceStore, createSync, platform, deviceNameDefault } = account;
  const [devices, setDevices] = useState(null);
  const [choice, setChoice] = useState('new');
  const [name, setName] = useState(() => deviceNameDefault());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice || '');
  const [offer, setOffer] = useState(null); // sync awaiting the upload/cancel decision
  const created = React.useRef(null); // device created by a failed earlier attempt

  useEffect(() => {
    let alive = true;
    client.listDevices().then(
      (d) => { if (alive) { setDevices(d); if (d.length) setChoice(d[0].id); } },
      (e) => { if (alive) { setDevices([]); setError(accountErrorMessage(e)); } },
    );
    return () => { alive = false; };
  }, [client]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try {
      const r = await fn();
      if (r && r.error) throw r.error;
      onDone();
    } catch (e) {
      setError(accountErrorMessage(e));
      setBusy(false);
    }
  };

  const proceed = async () => {
    setBusy(true); setError('');
    try {
      let id = choice;
      if (choice === 'new') {
        if (!created.current) created.current = (await client.createDevice({ name: name.trim() || deviceNameDefault(), platform })).id;
        id = created.current;
      }
      deviceStore.set(id);
      onDeviceStored();
      const sync = createSync(auth.containerKey, id);
      const empty = ((await client.getChanges(0, 1)).items || []).length === 0;
      const hasLocal = (await sync.snapshot()).size > 0;
      if (empty && hasLocal) { setOffer(sync); setBusy(false); return; }
      await run(() => sync.pull());
    } catch (e) {
      setError(accountErrorMessage(e));
      setBusy(false);
    }
  };

  if (offer) {
    // Once sync runs it uploads every local setting, so there is no "not now": continue, or sign out.
    const cancel = async () => {
      setBusy(true); setError('');
      try { await onCancel(); } catch (e) { setError(accountErrorMessage(e)); setBusy(false); }
    };
    return (
      <Shell>
        <h2>Upload this device's settings</h2>
        <p>Your account is empty. This device's settings will be uploaded to your account, including saved
          connections and sign-in tokens, so your other devices can use them.</p>
        <p>Cancel signs you out; nothing is uploaded.</p>
        {error && <p className="profile-setup__error" role="alert">{error}</p>}
        <button className="profile-setup__btn" disabled={busy} onClick={() => run(() => offer.seed())}>Continue</button>
        <button className="profile-setup__type" disabled={busy} onClick={cancel}>Cancel (sign out)</button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2>Which device is this?</h2>
      {devices === null ? <p>Loading…</p> : (
        <>
          {devices.map((d) => (
            <label key={d.id} className="profile-setup__label" style={{ flexDirection: 'row', gap: '0.5rem' }}>
              <input type="radio" name="device" checked={choice === d.id} onChange={() => setChoice(d.id)} />
              {d.name} ({d.platform})
            </label>
          ))}
          <label className="profile-setup__label" style={{ flexDirection: 'row', gap: '0.5rem' }}>
            <input type="radio" name="device" checked={choice === 'new'} onChange={() => setChoice('new')} />
            This is a new device
          </label>
          {choice === 'new' && <Field label="Device name" value={name} onChange={setName} />}
        </>
      )}
      {error && <p className="profile-setup__error" role="alert">{error}</p>}
      <button className="profile-setup__btn" disabled={busy || devices === null} onClick={proceed}>
        {busy ? 'Working…' : 'Continue'}
      </button>
    </Shell>
  );
}

// The profiles and item counts not synced yet, one line per profile ("Work: 2 items").
function UnsyncedList({ items }) {
  const profileApi = useProfile();
  const nameOf = (pid) => {
    const all = [...(profileApi?.profiles || []), ...(profileApi?.deletedProfiles || [])];
    return all.find((p) => p.id === pid)?.name || pid || 'Shared';
  };
  const counts = new Map();
  for (const { profileId } of items) counts.set(profileId, (counts.get(profileId) || 0) + 1);
  return (
    <ul>
      {[...counts].map(([pid, n]) => <li key={pid || '-'}>{nameOf(pid)}: {n} item{n === 1 ? '' : 's'}</li>)}
    </ul>
  );
}

// Password for the backup file, twice; calls onSave(password).
function BackupForm({ busy, onSave }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again !== '' && pw !== again;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (pw && pw === again) onSave(pw); }}>
      <Field label="Backup password" type="password" value={pw} onChange={setPw} autoFocus />
      <Field label="Repeat password" type="password" value={again} onChange={setAgain} />
      {mismatch && <p className="profile-setup__error" role="alert">The passwords do not match.</p>}
      <button className="profile-setup__btn" type="submit" disabled={busy || !pw || pw !== again}>Save backup</button>
    </form>
  );
}

// Warn that the previous account's data on this device will be removed before another account signs in.
// Without `onContinue` (the shell cannot clear local data) the screen only refuses: never sync a foreign session.
// With `checkUnpushed`, content not synced yet blocks the switch (owner decision "protect unsynced"):
// the previous account's session is gone at this point, so it cannot be synced from here. The owner
// can cancel and sign in to that account to let it sync, or export a backup (`exportBackup(password)`,
// resolving true once saved) and then remove it.
function SwitchScreen({ username, onContinue, onCancel, onSyncFirst, checkUnpushed, exportBackup }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unpushed, setUnpushed] = useState(checkUnpushed ? null : []);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  useEffect(() => {
    if (!checkUnpushed) return undefined;
    let alive = true;
    checkUnpushed().then(
      (list) => { if (alive) setUnpushed(Array.isArray(list) ? list : []); },
      () => { if (alive) { setUnpushed([{ id: '?', profileId: null }]); setError('Could not check this device for content that is not synced yet.'); } },
    );
    return () => { alive = false; };
  }, [checkUnpushed]);
  const go = async () => {
    setBusy(true); setError('');
    try { await onContinue(); } catch (e) { setError(accountErrorMessage(e)); setBusy(false); }
  };
  const saveBackup = async (password) => {
    setBusy(true); setError('');
    try {
      if (await exportBackup(password)) { setExported(true); setExporting(false); }
    } catch (e) {
      setError(e?.message || 'The backup could not be saved.');
    }
    setBusy(false);
  };
  if (onContinue && unpushed === null) return <Shell><p>Checking this device…</p></Shell>;
  if (onContinue && unpushed.length && !exported) {
    return (
      <Shell>
        <h2>Different account</h2>
        <p>This device has content from another account that has not been synced yet. Removing it now to
          continue as {username} would lose it:</p>
        <UnsyncedList items={unpushed} />
        {error && <p className="profile-setup__error" role="alert">{error}</p>}
        {exporting && <BackupForm busy={busy} onSave={saveBackup} />}
        {exportBackup && !exporting && (
          <button className="profile-setup__btn" disabled={busy} onClick={() => setExporting(true)}>Export a backup</button>
        )}
        <button className="profile-setup__type" disabled={busy} onClick={onSyncFirst}>Cancel and sync first</button>
        <button className="profile-setup__type" disabled={busy} onClick={onCancel}>Cancel</button>
      </Shell>
    );
  }
  if (onContinue && exported) {
    return (
      <Shell>
        <h2>Different account</h2>
        <p>Backup saved. Continue as {username} and remove the other account&apos;s data from this device?</p>
        {error && <p className="profile-setup__error" role="alert">{error}</p>}
        <button className="profile-setup__btn" disabled={busy} onClick={go}>Continue and remove</button>
        <button className="profile-setup__type" disabled={busy} onClick={onCancel}>Cancel</button>
      </Shell>
    );
  }
  if (!onContinue) {
    return (
      <Shell>
        <h2>Different account</h2>
        <p>This device has settings from another account, and they cannot be removed here, so {username} cannot
          sign in on this device. Sign out, then sign in with the account this device belongs to.</p>
        <button className="profile-setup__btn" onClick={onCancel}>Sign out</button>
      </Shell>
    );
  }
  return (
    <Shell>
      <h2>Different account</h2>
      <p>This device has settings from another account. Continue as {username} and remove them from this device?</p>
      {error && <p className="profile-setup__error" role="alert">{error}</p>}
      <button className="profile-setup__btn" disabled={busy} onClick={go}>Continue</button>
      <button className="profile-setup__type" disabled={busy} onClick={onCancel}>Cancel</button>
    </Shell>
  );
}

// "md_documents d1" for nexusmd:p.W.md_documents#d1, "ado.org" for p.W.ado.org.
export const syncItemLabel = (id) => String(id)
  .replace(/^sec:(?:nexusmd|helm):/, '').replace(/^(?:nexusmd|helm)[:.]/, '').replace(/^p\.[^.#]+\./, '').replace('#', ' ');

// A profile purged on another device while this one has edits to it (core pendingPurges): what will
// be discarded, Export first (a .nmdprofile of that profile), then Discard (confirmed), or Later.
function PendingPurgeNotice({ purge, exportBackup, onDiscard, onLater }) {
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const save = async (password) => {
    setBusy(true); setNote('');
    try { if (await exportBackup(password, purge.pid)) { setNote('Backup saved.'); setExporting(false); } }
    catch (e) { setNote(e?.message || 'The backup could not be saved.'); }
    setBusy(false);
  };
  const discard = async () => {
    if (!window.confirm(`Discard what this device still holds of "${purge.name}"? This cannot be undone.`)) return;
    setBusy(true);
    await onDiscard(purge.pid);
    setBusy(false);
  };
  return (
    <div className="profile-setup__notice" role="dialog" aria-label="Profile purged elsewhere"
      style={{ position: 'fixed', right: 16, bottom: 16, maxWidth: 420, zIndex: 1000, background: 'var(--surface, #fff)', border: '1px solid var(--border, #ccc)', borderRadius: 8, padding: 16, boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}>
      <p><strong>{purge.name} was deleted for good on another device.</strong> This device has changes to it that
        were never synced; discarding the profile here loses them:</p>
      <ul>{purge.unpushed.map((id) => <li key={id}>{syncItemLabel(id)}</li>)}</ul>
      {note && <p role="status">{note}</p>}
      {exporting && <BackupForm busy={busy} onSave={save} />}
      {exportBackup && !exporting && <button className="profile-setup__btn" disabled={busy} onClick={() => setExporting(true)}>Export first</button>}
      <button className="profile-setup__type" disabled={busy} onClick={discard}>Discard</button>
      <button className="profile-setup__type" disabled={busy} onClick={onLater}>Later</button>
    </div>
  );
}

/**
 * Gate that requires an account (or an explicit opt-out) before rendering `children`.
 * @param {{ account: {
 *   client: object, sessionStore: object,
 *   deviceStore: { get(): string|null, set(id: string|null): void },  // set(null) must clear the stored id
 *   boundUserKey?: string,           // localStorage key holding the userId this install's local data belongs to
 *   clearLocal?: () => Promise<void>, // removes the previous account's local data (see core clearAccountLocalData)
 *   unpushed?: () => Promise<Array<{ id, profileId }>>, // local content not synced yet (core listUnpushed): blocks a switch
 *   exportBackup?: (password: string, scope?: string) => Promise<boolean>, // saves a .nmdprofile (every profile, or one id); true once saved
 *   createSync: (containerKey: object, deviceId: string) => object,
 *   platform: 'windows'|'android'|'web'|'other',
 *   deviceNameDefault: () => string, optOutKey: string,
 *   serverName?: string,              // the server's host, shown in Data & sync so it is clear where profiles go
 *   activeProfileId?: () => string|null,   // the profile in use: with isLiveSafe, lets a pull that touched only other
 *   isLiveSafe?: (id: string) => boolean },  // profiles, or only settings screens can re-read, skip the reload
 *   reloadOnApplied?: boolean, children: React.ReactNode }} props
 *   When a different user signs in than `boundUserKey` records, the gate warns, then calls `clearLocal()`
 *   and `deviceStore.set(null)` before the device picker. With `boundUserKey` but no `clearLocal` the gate
 *   fails closed: a different user is refused (sign out only) and never synced. Both absent keeps the old
 *   behaviour. The user is bound the moment the device id is stored.
 *   A sync error 'not-found' (this device was removed from the account) stops sync, clears the device id
 *   and shows the device picker.
 *   `reloadOnApplied` (default true) reloads the page when a background pull changed local data.
 */
export function AccountGate({ account, reloadOnApplied = true, children }) {
  const { client, deviceStore, createSync, optOutKey, boundUserKey, clearLocal } = account;
  // phase: loading | auth | device | restoring | ready
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState(null);
  const [ck, setCk] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [notice, setNotice] = useState('');
  const [authed, setAuthed] = useState(null);
  const [expiredUser, setExpiredUser] = useState(null); // userId whose session expired
  const [deviceNotice, setDeviceNotice] = useState('');
  const sessionRef = React.useRef(null);
  sessionRef.current = session;
  const ckRef = React.useRef(null);
  ckRef.current = ck;
  const prevBound = React.useRef(undefined); // the bound user before this device pick (undefined: not bound yet)
  const [purges, setPurges] = useState([]); // pending purges (profiles purged elsewhere with unsynced edits here)
  const [purgesHidden, setPurgesHidden] = useState(false);

  const showAuth = useCallback(async (msg = '') => {
    setNotice(msg);
    try {
      setNeedsSetup((await client.status()).needsSetup);
    } catch (e) {
      setNeedsSetup(false);
      setNotice(msg || accountErrorMessage(e));
    }
    setPhase('auth');
  }, [client]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let optedOut = false;
      try { optedOut = localStorage.getItem(optOutKey) === '1'; } catch (err) { ignore(log, 'browser storage is unavailable', err); }
      if (optedOut) { setPhase('ready'); return; }
      try {
        const s = await client.getSession();
        if (s && deviceStore.get()) {
          const key = await importContainerKey(s.containerKey);
          if (!alive) return;
          let bound = null;
          try { bound = boundUserKey ? localStorage.getItem(boundUserKey) : null; } catch (err) { ignore(log, 'browser storage is unavailable', err); }
          if (bound && bound !== s.userId) {
            // The stored session belongs to a different user than this install's data (the app was
            // restarted on the switch warning): never sync until the data is cleared or sign-in is cancelled.
            // Without clearLocal the warning can only refuse (fail closed).
            setAuthed({ session: s, containerKey: key }); setPhase('confirm');
            return;
          }
          setSession(s); setCk(key); setPhase('ready');
          return;
        }
      } catch (err) { ignore(log, 'the stored session is unreadable, so the person signs in again', err, 'warn'); }
      if (alive) await showAuth();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = useMemo(
    () => (phase === 'ready' && session && ck ? createSync(ck, deviceStore.get()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, ck],
  );

  useEffect(() => {
    if (!sync) return undefined;
    const offs = [sync.onError((e) => {
      if (e && e.code === 'session-expired') {
        sync.stop();
        setExpiredUser(sessionRef.current ? sessionRef.current.userId : null);
        setSession(null); setCk(null);
        showAuth(accountErrorMessage(e));
      } else if (e && e.code === 'not-found') {
        // This device was removed from the account: its prefs are gone, so pick a device again.
        sync.stop();
        deviceStore.set(null);
        setAuthed({ session: sessionRef.current, containerKey: ckRef.current });
        setDeviceNotice('This device was removed from your account. Choose which device this is.');
        setSession(null); setCk(null);
        setPhase('device');
      }
    })];
    if (reloadOnApplied) {
      // Reload only when something needs it: see applied-policy.js. A change to a profile that is not in use needs nothing, and
      // one to a setting the open screens can read again (the sidebar, layout, hidden pages) is announced to them instead.
      offs.push(sync.onApplied((info) => {
        const act = appliedAction(info, { active: account.activeProfileId?.(), isLiveSafe: account.isLiveSafe });
        if (act.type === 'reload') window.location.reload();
        else if (act.type === 'live') {
          for (const collId of act.collIds) document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId } }));
        }
      }));
    }
    if (typeof sync.onConflict === 'function') {
      offs.push(sync.onConflict(({ count }) => toast(
        `${count} sync conflict${count === 1 ? ' needs' : 's need'} your decision — Settings › Data & sync`, 'info')));
    }
    if (typeof sync.pendingPurges === 'function') {
      const show = () => { setPurges(sync.pendingPurges()); setPurgesHidden(false); };
      show();
      if (typeof sync.onPendingPurge === 'function') offs.push(sync.onPendingPurge(show));
    }
    sync.start();
    return () => { offs.forEach((off) => off && off()); sync.stop(); };
  }, [sync, reloadOnApplied, showAuth]);

  const signOut = useCallback(async () => {
    if (sync) sync.stop();
    try { await client.logout(); } catch (err) { ignore(log, 'signing out failed; the local session is cleared regardless', err, 'warn'); }
    try { localStorage.removeItem(optOutKey); } catch (err) { ignore(log, 'browser storage is unavailable', err); }
    setSession(null); setCk(null); setExpiredUser(null);
    await showAuth();
  }, [sync, client, optOutKey, showAuth]);

  const optOut = () => {
    try { localStorage.setItem(optOutKey, '1'); } catch (err) { ignore(log, 'browser storage is unavailable', err); }
    setPhase('ready');
  };

  const onAuthed = (r) => {
    try { localStorage.removeItem(optOutKey); } catch (err) { ignore(log, 'browser storage is unavailable', err); }
    let foreign = false;
    try { const b = boundUserKey ? localStorage.getItem(boundUserKey) : null; foreign = !!b && b !== r.session.userId; } catch (err) { ignore(log, 'browser storage is unavailable', err); }
    if (!foreign && expiredUser && r.session.userId === expiredUser && deviceStore.get()) {
      // The same user signing back in on this device after an expiry: nothing to restore, keep local data as is.
      setSession(r.session); setCk(r.containerKey); setExpiredUser(null); setPhase('ready');
      return;
    }
    setAuthed(r);
    setDeviceNotice('');
    setPhase(foreign ? 'confirm' : 'device');
  };

  const cancelSwitch = async () => {
    try { await client.logout(); } catch (err) { ignore(log, 'signing out failed; the local session is cleared regardless', err, 'warn'); }
    await showAuth();
  };
  const syncFirst = async () => {
    try { await client.logout(); } catch (err) { ignore(log, 'signing out failed; the local session is cleared regardless', err, 'warn'); }
    await showAuth('Sign in with the account this device belongs to and let it sync, then switch accounts.');
  };

  const bindUser = () => {
    try {
      if (!boundUserKey || !authed) return;
      if (prevBound.current === undefined) prevBound.current = localStorage.getItem(boundUserKey);
      localStorage.setItem(boundUserKey, authed.session.userId);
    } catch (err) { ignore(log, 'browser storage is unavailable', err); }
  };

  // Cancel on the upload screen: nothing was uploaded, so the install goes back to how it was.
  const cancelUpload = async () => {
    deviceStore.set(null);
    try {
      if (boundUserKey && prevBound.current !== undefined) {
        if (prevBound.current == null) localStorage.removeItem(boundUserKey);
        else localStorage.setItem(boundUserKey, prevBound.current);
      }
    } catch (err) { ignore(log, 'browser storage is unavailable', err); }
    prevBound.current = undefined;
    try { await client.logout(); } catch (err) { ignore(log, 'signing out failed; the local session is cleared regardless', err, 'warn'); }
    await showAuth();
  };

  const serverName = account.serverName || '';
  const value = useMemo(() => ({ sync, session, signOut, serverName }), [sync, session, signOut, serverName]);

  if (phase === 'loading') return null;
  if (phase === 'ready') {
    const purge = !purgesHidden && sync ? purges[0] : null;
    return (
      <AccountContext.Provider value={value}>
        {children}
        {purge && (
          <PendingPurgeNotice key={purge.pid} purge={purge} exportBackup={account.exportBackup}
            onLater={() => setPurgesHidden(true)}
            onDiscard={async (pid) => {
              const r = await sync.confirmPurge(pid);
              if (r && r.error) return;
              setPurges(sync.pendingPurges());
              window.location.reload();
            }} />
        )}
      </AccountContext.Provider>
    );
  }
  if (phase === 'device') {
    return (
      <DeviceScreen account={account} auth={authed} notice={deviceNotice} onDeviceStored={bindUser} onCancel={cancelUpload}
        onDone={() => { setPhase('restoring'); window.location.reload(); }} />
    );
  }
  if (phase === 'confirm') {
    return (
      <SwitchScreen username={authed.session.username} onCancel={cancelSwitch} onSyncFirst={syncFirst}
        checkUnpushed={account.unpushed} exportBackup={account.exportBackup} onContinue={clearLocal ? async () => {
        await clearLocal();
        deviceStore.set(null);
        try { localStorage.removeItem(boundUserKey); } catch (err) { ignore(log, 'browser storage is unavailable', err); }
        setPhase('device');
      } : undefined} />
    );
  }
  if (phase === 'restoring') return <Shell><p>Restoring your settings…</p></Shell>;
  return <AuthScreen client={client} needsSetup={needsSetup} notice={notice} onAuthed={onAuthed} onOptOut={optOut} />;
}
