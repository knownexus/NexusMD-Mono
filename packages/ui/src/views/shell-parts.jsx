import React from 'react'
import { Icon } from '../icons.jsx'
import { Avatar } from '../app-components.jsx'

const { useState, useEffect, useRef } = React

// Small app-shell pieces that web and app render identically.

export function SettField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{hint}</span>}
    </div>
  );
}

// ── Setup screen (not yet configured) ─────────────────────────────────────────
export function SetupScreen({ onOpenSettings }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      gap: 16, color: 'var(--text-muted)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, background: 'var(--surface-2)',
        border: '1px solid var(--border)', display: 'grid', placeItems: 'center', fontSize: 26,
      }}>🔌</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Connect to Azure DevOps
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-subtle)', maxWidth: 360 }}>
          Enter your organisation name, a Personal Access Token, and project names to get started.
        </div>
      </div>
      <button className="btn primary" onClick={onOpenSettings}>
        <Icon name="settings" size={14}/> Configure connection
      </button>
    </div>
  );
}

// ── Loading screen ────────────────────────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      gap: 14, color: 'var(--text-subtle)',
    }}>
      <div style={{ fontSize: 13 }}>Loading data from Azure DevOps…</div>
    </div>
  );
}

function ProfileMenuItem({ icon, label, onClick, meta }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 7, width: '100%',
        background: 'transparent', border: 0, cursor: 'pointer',
        color: 'var(--text)', fontSize: 13, textAlign: 'left',
        fontFamily: 'var(--sans)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ color: 'var(--text-subtle)', display: 'grid', placeItems: 'center', width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {meta && <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>{meta}</span>}
    </button>
  );
}

export function ProfileMenu({ name, role, tweaks, setTweak, onOpenSettings, onOpenProjectAreas }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isDark = tweaks.theme === 'dark';
  const initials = (name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 6,
          width: 'max(calc(100% - 12px), 200px)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-pop)',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* Profile header */}
          <div style={{
            padding: '14px 14px 12px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'var(--accent)', color: 'var(--accent-fg)',
              display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 14, flexShrink: 0, letterSpacing: 0,
            }}>
              {initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>{role}</div>
            </div>
          </div>

          <div style={{ padding: 4 }}>
            <ProfileMenuItem
              icon={<Icon name={isDark ? 'sun' : 'moon'} size={14}/>}
              label={isDark ? 'Light mode' : 'Dark mode'}
              onClick={() => setTweak('theme', isDark ? 'light' : 'dark')}
            />
            <ProfileMenuItem
              icon={<Icon name="list" size={14}/>}
              label="Project Areas"
              onClick={() => { setOpen(false); onOpenProjectAreas(); }}
            />
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }}/>
            <ProfileMenuItem
              icon={<Icon name="settings" size={14}/>}
              label="Settings"
              onClick={() => { setOpen(false); onOpenSettings(); }}
            />
          </div>
        </div>
      )}

      <div
        className={`sidebar-foot profile-trigger${open ? ' profile-trigger--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Profile & settings"
      >
        <Avatar who="me"/>
        <div className="user-meta">
          <div className="user-name">{name}</div>
          <div className="user-role">{role}</div>
        </div>
        <span className="profile-trigger-caret">
          <Icon name="chevron-up" size={13}/>
        </span>
      </div>
    </div>
  );
}

// ── WidgetOrderEditor ─────────────────────────────────────────────────────────
export function WidgetOrderEditor({ order, onChange }) {
  const labels = { sprint:'Sprint progress', review:'Needs your review', blockers:'Blockers & risks', team:'Team — working on now', triage:'Triage queue', activity:'Recent activity', resolvedme:'Resolved by me' };
  const [drag, setDrag] = useState(null);
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {order.map((id,i)=>(
        <div key={id} draggable
          onDragStart={()=>setDrag(id)} onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault();if(!drag||drag===id)return;const arr=order.slice();const fi=arr.indexOf(drag),ti=arr.indexOf(id);arr.splice(fi,1);arr.splice(ti,0,drag);onChange(arr);setDrag(null);}}
          style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6,fontSize:12,cursor:'grab',opacity:drag===id?0.4:1}}>
          <Icon name="grip" size={12} style={{color:'var(--text-subtle)'}}/>
          <span style={{flex:1}}>{labels[id]||id}</span>
          <span className="muted mono" style={{fontSize:10}}>{i+1}</span>
        </div>
      ))}
    </div>
  );
}

export function Mini({ label, value, color }) {
  return (
    <div style={{background:'var(--surface-2)',padding:10,borderRadius:6}}>
      <div className="muted" style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'0.04em'}}>{label}</div>
      <div className="mono" style={{fontSize:16,fontWeight:600,color:color||'var(--text)'}}>{value}</div>
    </div>
  );
}
