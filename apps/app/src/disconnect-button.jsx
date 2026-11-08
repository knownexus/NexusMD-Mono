import React, { useState } from 'react';
import { disconnectProvider } from './disconnect.js';

// "Disconnect" for a connection sheet. It asks once, inline, before removing anything.
export function DisconnectButton({ provider, name, onDone }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const confirm = () => {
    try {
      disconnectProvider(provider);
      setAsking(false);
      onDone?.();
    } catch (e) {
      setError('Error: ' + (e?.message || 'could not disconnect'));
    }
  };

  if (!asking) {
    return (
      <button type="button" className="btn ghost m-btn-lg" style={{ color: 'var(--danger)' }}
        aria-label={`Disconnect ${name}`} onClick={() => { setError(''); setAsking(true); }}>
        Disconnect
      </button>
    );
  }
  return (
    <div role="group" aria-label={`Disconnect ${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      <div className="m-hint">Remove the {name} connection, its token and its cached data from this profile?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)' }} onClick={confirm}>Yes, disconnect</button>
        <button type="button" className="btn ghost m-btn-lg" onClick={() => setAsking(false)}>Cancel</button>
      </div>
      {error && <div className="m-error" role="status">{error}</div>}
    </div>
  );
}
