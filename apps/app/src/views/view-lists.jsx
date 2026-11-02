// view-lists.jsx — the mobile wrapper around the shared Lists view (@nexusmd/ui). The lists live in localStorage at
// getProfileKey('helm.lists') as { lists: [...] } (core Lists model, mobile namespace 'helm'); this wrapper reads
// and writes them and passes in the team and the profile's display name.
import React from 'react';
import { ListsView as SharedListsView } from '@nexusmd/ui';
import { readLists, writeLists } from '@nexusmd/core';
import { toast } from '../toast.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { Icon } from '../icons.jsx';

const listsStore = () => ({ storage: localStorage, getProfileKey, namespace: 'helm' });
const readDisplayName = () => {
  try { return localStorage.getItem(getProfileKey('helm.profile.displayName')) || ''; } catch (_) { return ''; }
};

function ListsView({ device = 'phone' } = {}) {
  const [data, setData] = React.useState(() => readLists(listsStore()));
  // A sync pull that changed the lists: read them again, so a later edit does not write stale data back.
  React.useEffect(() => {
    const onApplied = (e) => { if (e?.detail?.collId === 'lists') setData(readLists(listsStore())); };
    document.addEventListener('nexusmd:sync-applied', onApplied);
    return () => document.removeEventListener('nexusmd:sync-applied', onApplied);
  }, []);
  const onChange = (next) => { setData(next); writeLists(listsStore(), next); };
  return (
    <SharedListsView data={data} onChange={onChange} toast={toast} Icon={Icon} device={device}
      team={HelmData?.TEAM || []} displayName={readDisplayName()}/>
  );
}

export { ListsView };
