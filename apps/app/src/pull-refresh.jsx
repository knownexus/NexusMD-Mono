// pull-refresh.jsx — pull a screen down from the top to refresh it. Wraps a scrolling screen; only
// starts when the screen is already at the top, so normal scrolling is untouched.
import React from 'react';
import { Icon } from './icons.jsx';

export const PULL_TRIGGER = 64;   // how far (px, after damping) counts as a pull
export const PULL_MAX = 96;

// The finger's travel is damped so the pull feels weighted.
export const dampPull = (dy) => Math.max(0, Math.min(dy * 0.5, PULL_MAX));
export const pullLabel = (pull, busy) => (busy ? 'Refreshing…' : pull >= PULL_TRIGGER ? 'Release to refresh' : 'Pull to refresh');

export function PullRefresh({ onRefresh, className = 'm-screen', style, children }) {
  const ref = React.useRef(null);
  const startY = React.useRef(null);
  const [pull, setPull] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  const onTouchStart = (e) => { startY.current = !busy && ref.current && ref.current.scrollTop <= 0 ? e.touches[0].clientY : null; };
  const onTouchMove = (e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0 || (ref.current && ref.current.scrollTop > 0)) { setPull(0); return; }
    setPull(dampPull(dy));
  };
  const onTouchEnd = async () => {
    const go = pull >= PULL_TRIGGER && startY.current != null;
    startY.current = null;
    setPull(0);
    if (!go) return;
    setBusy(true);
    try { await onRefresh?.(); } catch { /* the screen shows its own errors */ } finally { setBusy(false); }
  };

  const show = pull > 0 || busy;
  return (
    <div ref={ref} className={className} style={style} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      {show && (
        <div className="m-pull" style={{ height: busy ? 40 : pull }} role="status">
          <Icon name="refresh" size={15} className={busy ? 'm-spin' : undefined}/> {pullLabel(pull, busy)}
        </div>
      )}
      {children}
    </div>
  );
}
