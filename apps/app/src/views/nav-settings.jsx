// nav-settings.jsx — choose which screens are in the bottom bar (or side rail), and in what order;
// the rest live in More. Two lists, each reorderable, and a button to move a screen between them.
import React from 'react';
import { Icon } from '../icons.jsx';
import { fromResolved, setPinned, moveInBar, moveInMore, PHONE_BAR_MAX } from '../nav-config.js';

export function NavSettings({ nav, onChange, onReset, max = PHONE_BAR_MAX }) {
  const [error, setError] = React.useState('');
  const pref = fromResolved(nav);
  const apply = (next) => { setError(''); onChange(next); };
  const pin = (id, pinned) => { const r = setPinned(pref, id, pinned, { max }); if (r.error) setError(r.error); else apply(r.pref); };

  const row = (t, i, list, inBar) => (
    <div key={t.id} className="m-row" style={{ cursor: 'default' }}>
      <span className="m-fileic"><Icon name={t.icon} size={17}/></span>
      <div className="m-row-main"><div className="m-row-title">{t.label}</div></div>
      <button type="button" className="m-iconbtn" aria-label={`Move ${t.label} up`} disabled={i === 0}
        onClick={() => apply((inBar ? moveInBar : moveInMore)(pref, t.id, -1))}><Icon name="chevron-up" size={16}/></button>
      <button type="button" className="m-iconbtn" aria-label={`Move ${t.label} down`} disabled={i === list.length - 1}
        onClick={() => apply((inBar ? moveInBar : moveInMore)(pref, t.id, 1))}><Icon name="chevron-down" size={16}/></button>
      <button type="button" className="btn m-btn-lg" style={{ minWidth: 92, justifyContent: 'center' }}
        aria-label={inBar ? `Move ${t.label} to More` : `Show ${t.label} in the bar`} onClick={() => pin(t.id, !inBar)}>
        {inBar ? 'To More' : 'Show'}
      </button>
    </div>
  );

  return (
    <div style={{ padding: '10px 16px 14px' }}>
      <div className="m-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        The bar holds up to {max} screens. Everything else is under More, which is always there.
      </div>
      <div className="m-sec-h"><span className="lbl">In the bar</span><span className="line"/><span className="cnt">{nav.bar.length}/{max}</span></div>
      <div className="m-card flush">{nav.bar.map((t, i) => row(t, i, nav.bar, true))}</div>
      <div className="m-sec-h"><span className="lbl">In More</span><span className="line"/><span className="cnt">{nav.more.length}</span></div>
      {nav.more.length === 0
        ? <div className="m-hint">Nothing here: every screen is in the bar.</div>
        : <div className="m-card flush">{nav.more.map((t, i) => row(t, i, nav.more, false))}</div>}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      <button type="button" className="btn ghost m-btn-lg" style={{ marginTop: 10 }} onClick={() => { setError(''); onReset(); }}>Reset to the default</button>
    </div>
  );
}
