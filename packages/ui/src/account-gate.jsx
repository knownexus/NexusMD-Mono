// account-gate.jsx — optional sign-in gate for the NexusMD account (settings sync). It sits OUTSIDE
// the profile gate: once an account is signed in (or the user opted out) it renders its children.
// It owns the sync lifecycle: it creates the sync, starts it while children are shown, stops it on
// sign-out/unmount, and reloads the page when a pull changed local data.
import React from 'react';
import { importContainerKey } from '@nexusmd/core';

const { useState, useEffect, useMemo, useCallback, useContext, createContext } = React;

const MESSAGES = {
  invalid: 'Username or password is incorrect.',
  locked: 'Too many failed attempts. This account is locked for a while; try again later.',
  disabled: 'This account has been disabled. Ask an administrator.',
  forbidden: 'That was not accepted. Check the setup token or invite code, or your permissions.',
  conflict: 'That username is already taken.',
  offline: 'Cannot reach the server. Check your connection and try again.',
  'session-expired': 'Your session has expired. Sign in again.',
  'keys-corrupt': 'Your account keys could not be opened. Contact an administrator.',
  server: 'The server had a problem. Try again shortly.',
  'not-found': 'That could not be found.',
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
function DeviceScreen({ account, auth, onDone }) {
  const { client, deviceStore, createSync, platform, deviceNameDefault } = account;
  const [devices, setDevices] = useState(null);
  const [choice, setChoice] = useState('new');
  const [name, setName] = useState(() => deviceNameDefault());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offer, setOffer] = useState(null); // sync awaiting the upload/skip decision
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
    return (
      <Shell>
        <h2>Upload this device's settings?</h2>
        <p>Your account is empty. Upload the settings on this device so your other devices can use them.</p>
        {error && <p className="profile-setup__error" role="alert">{error}</p>}
        <button className="profile-setup__btn" disabled={busy} onClick={() => run(() => offer.seed())}>
          Upload this device's settings
        </button>
        <button className="profile-setup__type" disabled={busy} onClick={() => run(() => offer.pull())}>Not now</button>
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

// Warn that the previous account's settings on this device will be removed before another account signs in.
function SwitchScreen({ username, onContinue, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await onContinue(); } catch (e) { setError(accountErrorMessage(e)); setBusy(false); }
  };
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

/**
 * Gate that requires an account (or an explicit opt-out) before rendering `children`.
 * @param {{ account: {
 *   client: object, sessionStore: object,
 *   deviceStore: { get(): string|null, set(id: string|null): void },  // set(null) must clear the stored id
 *   boundUserKey?: string,           // localStorage key holding the userId this install's local data belongs to
 *   clearLocal?: () => Promise<void>, // removes the previous account's local data (see core clearAccountLocalData)
 *   createSync: (containerKey: object, deviceId: string) => object,
 *   platform: 'windows'|'android'|'web'|'other',
 *   deviceNameDefault: () => string, optOutKey: string },
 *   reloadOnApplied?: boolean, children: React.ReactNode }} props
 *   When a different user signs in than `boundUserKey` records, the gate warns, then calls `clearLocal()`
 *   and `deviceStore.set(null)` before the device picker; both props absent keeps the old behaviour.
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
  const sessionRef = React.useRef(null);
  sessionRef.current = session;

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
      try { optedOut = localStorage.getItem(optOutKey) === '1'; } catch { /* storage unavailable */ }
      if (optedOut) { setPhase('ready'); return; }
      try {
        const s = await client.getSession();
        if (s && deviceStore.get()) {
          const key = await importContainerKey(s.containerKey);
          if (!alive) return;
          let bound = null;
          try { bound = boundUserKey ? localStorage.getItem(boundUserKey) : null; } catch { /* storage unavailable */ }
          if (bound && clearLocal && bound !== s.userId) {
            // The stored session belongs to a different user than this install's data (the app was
            // restarted on the switch warning): never sync until the data is cleared or sign-in is cancelled.
            setAuthed({ session: s, containerKey: key }); setPhase('confirm');
            return;
          }
          setSession(s); setCk(key); setPhase('ready');
          return;
        }
      } catch { /* unreadable stored session: sign in again */ }
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
      }
    })];
    if (reloadOnApplied) offs.push(sync.onApplied(() => window.location.reload()));
    sync.start();
    return () => { offs.forEach((off) => off && off()); sync.stop(); };
  }, [sync, reloadOnApplied, showAuth]);

  const signOut = useCallback(async () => {
    if (sync) sync.stop();
    try { await client.logout(); } catch { /* local session is cleared regardless */ }
    try { localStorage.removeItem(optOutKey); } catch { /* storage unavailable */ }
    setSession(null); setCk(null); setExpiredUser(null);
    await showAuth();
  }, [sync, client, optOutKey, showAuth]);

  const optOut = () => {
    try { localStorage.setItem(optOutKey, '1'); } catch { /* storage unavailable */ }
    setPhase('ready');
  };

  const onAuthed = (r) => {
    try { localStorage.removeItem(optOutKey); } catch { /* storage unavailable */ }
    let foreign = false;
    try { const b = boundUserKey ? localStorage.getItem(boundUserKey) : null; foreign = !!b && b !== r.session.userId; } catch { /* storage unavailable */ }
    if (!foreign && expiredUser && r.session.userId === expiredUser && deviceStore.get()) {
      // The same user signing back in on this device after an expiry: nothing to restore, keep local data as is.
      setSession(r.session); setCk(r.containerKey); setExpiredUser(null); setPhase('ready');
      return;
    }
    setAuthed(r);
    setPhase(foreign && clearLocal ? 'confirm' : 'device');
  };

  const cancelSwitch = async () => {
    try { await client.logout(); } catch { /* local session is cleared regardless */ }
    await showAuth();
  };

  const bindUser = () => {
    try { if (boundUserKey && authed) localStorage.setItem(boundUserKey, authed.session.userId); } catch { /* storage unavailable */ }
  };

  const value = useMemo(() => ({ sync, session, signOut }), [sync, session, signOut]);

  if (phase === 'loading') return null;
  if (phase === 'ready') return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
  if (phase === 'device') {
    return <DeviceScreen account={account} auth={authed} onDone={() => { bindUser(); setPhase('restoring'); window.location.reload(); }} />;
  }
  if (phase === 'confirm') {
    return (
      <SwitchScreen username={authed.session.username} onCancel={cancelSwitch} onContinue={async () => {
        await clearLocal();
        deviceStore.set(null);
        try { localStorage.removeItem(boundUserKey); } catch { /* storage unavailable */ }
        setPhase('device');
      }} />
    );
  }
  if (phase === 'restoring') return <Shell><p>Restoring your settings…</p></Shell>;
  return <AuthScreen client={client} needsSetup={needsSetup} notice={notice} onAuthed={onAuthed} onOptOut={optOut} />;
}
