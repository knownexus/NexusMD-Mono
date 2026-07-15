// icons.jsx — Single-purpose SVG icon set

export const Icon = ({ name, size = 16, stroke = 1.6, className = '', style = {} }) => {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
    className, style,
  };
  switch (name) {
    case 'dashboard': return (<svg {...props}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>);
    case 'work':      return (<svg {...props}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 5v-2h6v2"/></svg>);
    case 'pr':        return (<svg {...props}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8M11 6h4a3 3 0 0 1 3 3v7"/><path d="M14 9l-3-3 3-3" transform="translate(1 0)"/></svg>);
    case 'build':     return (<svg {...props}><path d="M4 4h16v6H4zM4 14h16v6H4z"/><circle cx="7.5" cy="7" r="0.6" fill="currentColor"/><circle cx="7.5" cy="17" r="0.6" fill="currentColor"/></svg>);
    case 'team':      return (<svg {...props}><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="7" r="2.5"/><path d="M21.5 17.5a4.5 4.5 0 0 0-6-4.2"/></svg>);
    case 'planner':   return (<svg {...props}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M8 14l2 2 4-4"/></svg>);
    case 'sprint':    return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
    case 'settings':  return (<svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>);
    case 'search':    return (<svg {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>);
    case 'plus':      return (<svg {...props}><path d="M12 5v14M5 12h14"/></svg>);
    case 'chevron-down':  return (<svg {...props}><path d="m6 9 6 6 6-6"/></svg>);
    case 'chevron-right': return (<svg {...props}><path d="m9 6 6 6-6 6"/></svg>);
    case 'chevron-left':  return (<svg {...props}><path d="m15 6-6 6 6 6"/></svg>);
    case 'chevron-up':    return (<svg {...props}><path d="m6 15 6-6 6 6"/></svg>);
    case 'arrow-up':  return (<svg {...props}><path d="M12 19V5M5 12l7-7 7 7"/></svg>);
    case 'arrow-down':return (<svg {...props}><path d="M12 5v14M5 12l7 7 7-7"/></svg>);
    case 'arrow-right':return (<svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>);
    case 'check':     return (<svg {...props}><path d="m5 12 5 5L20 7"/></svg>);
    case 'x':         return (<svg {...props}><path d="M18 6 6 18M6 6l12 12"/></svg>);
    case 'circle':    return (<svg {...props}><circle cx="12" cy="12" r="9"/></svg>);
    case 'check-circle': return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>);
    case 'alert':     return (<svg {...props}><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/></svg>);
    case 'info':      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>);
    case 'fire':      return (<svg {...props}><path d="M12 2c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 2-10z"/></svg>);
    case 'filter':    return (<svg {...props}><path d="M3 4h18l-7 9v6l-4 2v-8z"/></svg>);
    case 'sort':      return (<svg {...props}><path d="M3 6h18M6 12h12M10 18h4"/></svg>);
    case 'list':      return (<svg {...props}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>);
    case 'board':     return (<svg {...props}><rect x="3" y="3" width="6" height="18" rx="1.5"/><rect x="15" y="3" width="6" height="11" rx="1.5"/><rect x="9" y="3" width="6" height="14" rx="1.5"/></svg>);
    case 'grip':      return (<svg {...props} stroke="none" fill="currentColor"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>);
    case 'more':      return (<svg {...props} stroke="none" fill="currentColor"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>);
    case 'bell':      return (<svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>);
    case 'message':   return (<svg {...props}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.5 8.5 0 0 1-3.7-.8L3 21l1.8-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>);
    case 'merge':     return (<svg {...props}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M6 6c0 6 6 6 10 6"/></svg>);
    case 'git-branch': return (<svg {...props}><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 8v8M18 8c0 4-6 4-12 6"/></svg>);
    case 'clock':     return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
    case 'lock':      return (<svg {...props}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>);
    case 'comment':   return (<svg {...props}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.5 8.5 0 0 1-3.7-.8L3 21l1.8-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>);
    case 'star':      return (<svg {...props}><path d="m12 2 3 7 7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z"/></svg>);
    case 'flag':      return (<svg {...props}><path d="M4 21V4M4 4h13l-2 5 2 5H4"/></svg>);
    case 'link':      return (<svg {...props}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1-1"/></svg>);
    case 'sun':       return (<svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>);
    case 'moon':      return (<svg {...props}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>);
    case 'sunset':    return (<svg {...props}><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3"/><path d="M6 18a6 6 0 1 1 12 0"/><line x1="3" y1="18" x2="21" y2="18"/></svg>);
    case 'help':      return (<svg {...props}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 4M12 17h.01"/></svg>);
    case 'cmd':       return (<svg {...props}><path d="M7 4a2 2 0 1 1 2 2v12a2 2 0 1 1-2-2zM17 4a2 2 0 1 0-2 2v12a2 2 0 1 0 2-2zM9 6h6M9 18h6"/></svg>);
    case 'eye':       return (<svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>);
    case 'inbox':     return (<svg {...props}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>);
    case 'pin':       return (<svg {...props}><path d="m12 2 3 4 4 1-3 3 1 5-5-2-5 2 1-5-3-3 4-1z" /></svg>);
    case 'edit':      return (<svg {...props}><path d="M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>);
    case 'trash':     return (<svg {...props}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>);
    case 'send':      return (<svg {...props}><path d="m22 2-20 9 9 4 4 9z"/></svg>);
    case 'play':      return (<svg {...props} fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>);
    case 'pause':     return (<svg {...props}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>);
    case 'refresh':   return (<svg {...props}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4"/></svg>);
    case 'doc':       return (<svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>);
    case 'folder':    return (<svg {...props}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>);
    case 'logo':      return (<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" opacity=".25"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>);
    default: return null;
  }
};
