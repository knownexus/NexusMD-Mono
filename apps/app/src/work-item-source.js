// work-item-source.js — the app's WorkItemDetail data source. The shared
// @nexusmd/ui WorkItemDetail renders against a normalised shape; this talks to
// Azure DevOps directly (Capacitor app, no ASP.NET host) and maps ADO → that shape.
// Passed to <NexusDataProvider value={{ workItemSource: adoWorkItemSource }}>.
import { adoMoveToCategory } from '@nexusmd/core';
import { adoGet, adoPost, adoPatch } from './ado-client.js';
import { HelmData } from './data.jsx';

export const adoWorkItemSource = {
  async loadDetail(id, _project) {
    const wiData = await adoGet(`_apis/wit/workitems/${id}?$expand=all&api-version=7.0`);
    const fields = wiData?.fields || {};
    return {
      description:        fields['System.Description']                       || null,
      acceptanceCriteria: fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || null,
      reproSteps:         fields['Microsoft.VSTS.TCM.ReproSteps']            || null,
    };
  },

  async loadComments(id, project) {
    const proj = project || (HelmData?.CONFIG_PROJECTS || [])[0] || '';
    if (!proj) return [];
    const projEnc = encodeURIComponent(proj);
    let commentsData;
    try {
      commentsData = await adoGet(`${projEnc}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`);
    } catch { return []; }
    return (commentsData?.comments || []).map(c => ({
      id:          c.id,
      author:      c.createdBy?.displayName || '',
      text:        c.text || c.renderedText || '',
      createdDate: c.createdDate || '',
    }));
  },

  async saveField(itemId, field, html) {
    await adoPatch(`_apis/wit/workitems/${itemId}?api-version=7.0`,
      [{ op: 'add', path: `/fields/${field}`, value: html }]);
  },

  async addComment(id, project, html) {
    const proj = encodeURIComponent(project || (HelmData.CONFIG_PROJECTS || [])[0] || '');
    const data = await adoPost(
      `${proj}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`,
      { comments: [{ parentCommentId: 0, content: html, commentType: 1 }], status: 1 },
    );
    return {
      id:          data.id,
      author:      data.createdBy?.displayName || '',
      text:        html,
      createdDate: data.createdDate || new Date().toISOString(),
    };
  },

  async loadRawFields(id) {
    const data = await adoGet(`_apis/wit/workitems/${id}?$expand=fields&api-version=7.0`);
    return data?.fields || {};
  },

  // Workflow-aware: resolves the project's real state for the category from the cached process metadata.
  async moveToCategory(id, category, item) {
    return adoMoveToCategory({
      item, category, meta: HelmData._adoMeta,
      saveState: (state) => adoWorkItemSource.saveField(id, 'System.State', state),
    });
  },
};
