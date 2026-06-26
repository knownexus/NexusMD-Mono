import React from 'react'

const { useState, useCallback, createElement: h } = React;

const PROFILE_COLORS = ['#9a7e22','#1d6fcc','#48b870','#e8a020','#cc2244','#8098e0','#b84848'];

const TYPES = [
  { id: 'ado',    label: 'Azure DevOps', desc: 'Connect to Azure DevOps for work items, PRs, builds, and team.' },
  { id: 'github', label: 'GitHub',       desc: 'Connect to GitHub for issues, pull requests, and Actions workflows.' },
  { id: 'manual', label: 'Manual',       desc: 'No external tool. Use the planner, notes, team, and calendar offline.' },
];

function ProfileSetup({ onComplete }) {
  const [step,        setStep]        = useState(1);
  const [name,        setName]        = useState('');
  const [initials,    setInitials]    = useState('');
  const [color,       setColor]       = useState(PROFILE_COLORS[0]);
  const [type,        setType]        = useState('ado');
  const [adoOrg,      setAdoOrg]      = useState('');
  const [adoPat,      setAdoPat]      = useState('');
  const [adoProjects, setAdoProjects] = useState('');
  const [ghPat,       setGhPat]       = useState('');
  const [ghRepos,     setGhRepos]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const autoInitials = n => n.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();

  const handleNameChange = v => {
    setName(v);
    if (!initials || initials === autoInitials(name)) setInitials(autoInitials(v));
  };

  const handleFinish = useCallback(async () => {
    setSaving(true); setError('');
    try {
      const config = type === 'ado'
        ? JSON.stringify({ org: adoOrg.trim(), pat: adoPat.trim(), projects: adoProjects.split(',').map(s => s.trim()).filter(Boolean) })
        : type === 'github'
        ? JSON.stringify({ pat: ghPat.trim(), repos: ghRepos.split(',').map(s => s.trim()).filter(Boolean) })
        : null;

      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), initials: initials.trim(), color, type, config }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to create profile.');
      const profile = await res.json();
      await fetch(`/api/profiles/${profile.id}/activate`, { method: 'POST' });
      localStorage.setItem('nexusmd.activeProfileId', profile.id);
      localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: profile.id, name: profile.name, initials: profile.initials, color: profile.color, type: profile.type }]));
      onComplete(profile);
    } catch (e) { setError(e.message || 'Something went wrong.'); setSaving(false); }
  }, [name, initials, color, type, adoOrg, adoPat, adoProjects, ghPat, ghRepos, onComplete]);

  const step1Valid = name.trim().length > 0 && initials.trim().length > 0;
  const step3Valid = type === 'ado'    ? adoOrg.trim() && adoPat.trim()
                   : type === 'github' ? ghPat.trim()
                   : true;

  if (step === 1) return h('div', { className: 'profile-setup' },
    h('div', { className: 'profile-setup__card' },
      h('h2', null, 'Welcome to NexusMD'),
      h('p', null, 'Set up your profile to get started.'),
      h('label', { className: 'profile-setup__label' }, 'Your name',
        h('input', { className: 'profile-setup__input', value: name, onInput: e => handleNameChange(e.target.value), placeholder: 'e.g. Phil', autoFocus: true })),
      h('label', { className: 'profile-setup__label' }, 'Initials (2–3 chars)',
        h('input', { className: 'profile-setup__input', value: initials, onInput: e => setInitials(e.target.value.toUpperCase().slice(0, 3)), placeholder: 'e.g. PH', maxLength: 3 })),
      h('p', { className: 'profile-setup__label' }, 'Colour'),
      h('div', { className: 'profile-setup__colors' },
        PROFILE_COLORS.map(c => h('button', { key: c, type: 'button',
          className: 'profile-setup__swatch' + (c === color ? ' active' : ''),
          style: { background: c }, onClick: () => setColor(c) }))),
      h('button', { className: 'profile-setup__btn', disabled: !step1Valid, onClick: () => setStep(2) }, 'Next →')
    )
  );

  if (step === 2) return h('div', { className: 'profile-setup' },
    h('div', { className: 'profile-setup__card' },
      h('h2', null, 'Choose a connection type'),
      h('div', { className: 'profile-setup__types' },
        TYPES.map(t => h('button', { key: t.id, type: 'button',
          className: 'profile-setup__type' + (t.id === type ? ' active' : ''),
          onClick: () => setType(t.id) },
          h('strong', null, t.label),
          h('span',   null, t.desc)
        ))),
      error && h('p', { className: 'profile-setup__error' }, error),
      h('div', { className: 'profile-setup__nav' },
        h('button', { type: 'button', onClick: () => setStep(1) }, '← Back'),
        h('button', { type: 'button', className: 'profile-setup__btn', disabled: saving,
          onClick: () => type === 'manual' ? handleFinish() : setStep(3) },
          saving ? 'Creating…' : type === 'manual' ? 'Create profile' : 'Next →')
      )
    )
  );

  return h('div', { className: 'profile-setup' },
    h('div', { className: 'profile-setup__card' },
      h('h2', null, type === 'ado' ? 'Connect Azure DevOps' : 'Connect GitHub'),
      type === 'ado' && h(React.Fragment, null,
        h('label', { className: 'profile-setup__label' }, 'Organisation name',
          h('input', { className: 'profile-setup__input', value: adoOrg, onInput: e => setAdoOrg(e.target.value), placeholder: 'e.g. mycompany' })),
        h('label', { className: 'profile-setup__label' }, 'Personal Access Token',
          h('input', { type: 'password', className: 'profile-setup__input', value: adoPat, onInput: e => setAdoPat(e.target.value), placeholder: 'Paste your PAT here' })),
        h('label', { className: 'profile-setup__label' }, 'Projects (comma-separated)',
          h('input', { className: 'profile-setup__input', value: adoProjects, onInput: e => setAdoProjects(e.target.value), placeholder: 'e.g. MyProject, OtherProject' }))
      ),
      type === 'github' && h(React.Fragment, null,
        h('label', { className: 'profile-setup__label' }, 'Personal Access Token',
          h('input', { type: 'password', className: 'profile-setup__input', value: ghPat, onInput: e => setGhPat(e.target.value), placeholder: 'Paste your GitHub PAT here' })),
        h('label', { className: 'profile-setup__label' }, 'Repositories (owner/repo, comma-separated)',
          h('input', { className: 'profile-setup__input', value: ghRepos, onInput: e => setGhRepos(e.target.value), placeholder: 'e.g. myorg/backend, myorg/frontend' }))
      ),
      error && h('p', { className: 'profile-setup__error' }, error),
      h('div', { className: 'profile-setup__nav' },
        h('button', { type: 'button', onClick: () => setStep(2) }, '← Back'),
        h('button', { type: 'button', className: 'profile-setup__btn', disabled: saving || !step3Valid, onClick: handleFinish },
          saving ? 'Creating…' : 'Create profile')
      )
    )
  );
}

export { ProfileSetup }
