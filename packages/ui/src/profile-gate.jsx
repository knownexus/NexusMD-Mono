// profile-gate.jsx — first-run gate shared by the app and desktop. Nothing seeds a profile for
// them: until one exists the app renders this instead of its children, and creating it
// reloads into the new (active) profile. Web has its own server-backed ProfileSetup.
import React from 'react';
import { useProfile } from './profile-context.jsx';
import { PROFILE_COLORS, PROFILE_TYPES } from './views/view-settings.jsx';

const { useState } = React;

const autoInitials = (n) => n.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();

export function ProfileGate({ children }) {
  const api = useProfile();
  const [name, setName]         = useState('');
  const [initials, setInitials] = useState('');
  const [color, setColor]       = useState(PROFILE_COLORS[0]);
  const [type, setType]         = useState('ado');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  if (api.loading) return null;
  if (api.profiles.length > 0) return children;

  const changeName = (v) => {
    if (!initials || initials === autoInitials(name)) setInitials(autoInitials(v));
    setName(v);
  };

  const create = async () => {
    setSaving(true); setError('');
    try {
      const p = await api.createProfile({ name: name.trim(), initials: initials.trim() || autoInitials(name), color, type });
      await api.switchProfile(p.id);
    } catch (e) { setError(e?.message || 'Could not create the profile.'); setSaving(false); }
  };

  return (
    <div className="profile-setup">
      <div className="profile-setup__card">
        <h2>Welcome to NexusMD</h2>
        <p>Create a profile to get started. You can add more, or switch between them, in Settings.</p>
        <label className="profile-setup__label">Profile name
          <input className="profile-setup__input" value={name} autoFocus placeholder="e.g. Work"
            onChange={e => changeName(e.target.value)} />
        </label>
        <label className="profile-setup__label">Initials (2–3 chars)
          <input className="profile-setup__input" value={initials} maxLength={3} placeholder="e.g. WK"
            onChange={e => setInitials(e.target.value.toUpperCase().slice(0, 3))} />
        </label>
        <p className="profile-setup__label">Colour</p>
        <div className="profile-setup__colors">
          {PROFILE_COLORS.map(c => (
            <button key={c} type="button" aria-label={c}
              className={'profile-setup__swatch' + (c === color ? ' active' : '')}
              style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <p className="profile-setup__label">Type</p>
        <div className="profile-setup__types">
          {PROFILE_TYPES.map(t => (
            <button key={t.id} type="button"
              className={'profile-setup__type' + (t.id === type ? ' active' : '')}
              onClick={() => setType(t.id)}>
              <strong>{t.label}</strong><span>{t.desc}</span>
            </button>
          ))}
        </div>
        {error && <p className="profile-setup__error">{error}</p>}
        <button className="profile-setup__btn" disabled={saving || !name.trim()} onClick={create}>
          {saving ? 'Creating…' : 'Create profile'}
        </button>
      </div>
    </div>
  );
}
