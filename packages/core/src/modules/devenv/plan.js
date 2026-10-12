// packages/core/src/modules/devenv/plan.js
//
// The `devenv start` plan prompt (devplan's DTO) as an editable form, and the answer it
// sends back (devplan's result format), so NexusMD and devplan.exe drive the same loop.

const list = v => (Array.isArray(v) ? v : [])

function defaultBaseline(plan) {
  const ids = list(plan.backups).map(b => b.id)
  if (plan.baseline && ids.includes(plan.baseline)) return plan.baseline
  if (plan.rememberedBaseline && ids.includes(plan.rememberedBaseline)) return plan.rememberedBaseline
  return list(plan.backups).find(b => b.isLatest)?.id ?? ids[0] ?? null
}

export function createPlanForm(plan) {
  const services = {}
  for (const s of list(plan.services)) services[s.key] = s.action || 'build'
  return {
    services,
    database: plan.database || 'asis',
    baseline: defaultBaseline(plan),
    wipeConfirm: '',
    emulator: plan.emulator === true,
    ios: plan.ios || 'off',
    test: plan.test || 'off',
    testServices: list(plan.testServices).map(String),
  }
}

/** @returns {string|null} why Start can't go ahead, or null. */
export function validatePlanForm(plan, form) {
  if (!plan.locked) return `Pick a branch that exists for every source first: ${plan.lockError || 'a ref did not resolve'}`
  const restoring = form.database === 'restore' || form.database === 'wipe'
  if (restoring && (!list(plan.backups).length || !form.baseline)) return 'No saved baseline to restore — run devenv db backup first'
  if (form.database === 'wipe' && form.wipeConfirm !== 'YES') return 'Type YES to wipe the local database'
  if (form.test !== 'off' && !form.testServices.length) return 'Pick at least one API for the test stack'
  return null
}

/** @param {'start'|'cancel'|string} action  'change-ref:<key>' opens that source's branch picker. */
export function buildPlanAnswer(form, action) {
  const restoring = form.database === 'restore' || form.database === 'wipe'
  return {
    action,
    services: { ...form.services },
    database: form.database,
    baseline: restoring ? form.baseline : null,
    emulator: form.emulator,
    ios: form.ios,
    test: form.test,
    testServices: [...form.testServices],
  }
}

export function normaliseRefPrompt(prompt) {
  const r = prompt?.ref || {}
  return {
    name: String(r.name ?? ''),
    current: String(r.current ?? ''),
    worktrees: list(r.worktrees).map(w => ({ path: String(w.path ?? ''), ref: String(w.ref ?? ''), display: String(w.display ?? w.ref ?? ''), folder: String(w.folder ?? ''), current: w.current === true })),
    remotes: list(r.remotes).map(String),
  }
}
