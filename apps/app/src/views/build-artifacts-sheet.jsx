// build-artifacts-sheet.jsx — the artifacts of one build, each with a Download button. The file is saved
// wherever the user picks in Android's save dialog.
import React from 'react';
import { Sheet } from '../components.jsx';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { listArtifacts, saveArtifact, formatSize, downloadsSupported } from '../build-artifacts.js';

export function BuildArtifactsSheet({ build, onClose, list = listArtifacts, save = saveArtifact, supported = downloadsSupported }) {
  const [items, setItems] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState('');

  React.useEffect(() => {
    if (!build) return;
    setItems(null); setError(''); setBusy('');
    let live = true;
    list(build)
      .then(r => { if (live) setItems(r); })
      .catch(e => { if (live) { setItems([]); setError(e?.message || 'Could not load the artifacts.'); } });
    return () => { live = false; };
  }, [build?.id, build?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (item) => {
    setBusy(item.url);
    try {
      const r = await save(item);
      if (!r?.cancelled) toast?.(`Saved ${item.filename}${r?.bytes ? ` (${formatSize(r.bytes)})` : ''}.`, 'success');
    } catch (e) {
      toast?.(e?.message || 'Download failed.', 'error');
    }
    setBusy('');
  };

  return (
    <Sheet open={!!build} size="tall" onClose={onClose}
      title="Artifacts" sub={build ? `${build.pipeline} · ${build.source === 'github' ? 'run' : 'build'} ${build.id}` : ''}
      footer={<button type="button" className="btn ghost m-btn-lg" onClick={onClose}>Close</button>}>
      {items === null && <div className="m-empty"><div className="et">Loading…</div></div>}
      {error && <div className="m-empty"><div className="et">{error}</div></div>}
      {items && !error && items.length === 0 && (
        <div className="m-empty"><div className="et">This build published no artifacts.</div></div>
      )}
      {items && items.length > 0 && (
        <div className="m-card flush">
          {items.map(item => (
            <div key={item.url} className="m-row">
              <span className="m-fileic"><Icon name="inbox" size={17}/></span>
              <div className="m-row-main">
                <div className="m-row-title">{item.name}</div>
                <div className="m-row-sub">{item.expired ? 'Expired' : (formatSize(item.size) || 'Zip')}</div>
              </div>
              <button type="button" className="btn sm" disabled={item.expired || !supported() || busy === item.url}
                title={supported() ? '' : 'Downloads work in the Android app'}
                onClick={() => download(item)}>
                <Icon name="download" size={12}/> {busy === item.url ? 'Saving…' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
