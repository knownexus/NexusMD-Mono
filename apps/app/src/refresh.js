// refresh.js — refresh the data from a button, and say so when it did not work.
import { HelmApi } from './data.jsx';
import { toast } from './toast.jsx';

export async function refreshNow() {
  try { await HelmApi?.load(); }
  catch (e) { toast?.(`Could not refresh. ${e?.message || ''}`.trim(), 'error'); }
}
