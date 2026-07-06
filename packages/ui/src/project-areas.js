import React from 'react'

// project-areas.js — the org's area-path tree. This is NOT fetched from ADO;
// it's a hand-maintained constant describing the module/service structure,
// optionally overridden per-profile via storage. Ported from
// apps/app/src/app.jsx's DEFAULT_PROJECT_AREAS + the projectAreas useState/
// useEffect pair (app.jsx:1427-1440), decoupled from the HelmData global.

export const DEFAULT_PROJECT_AREAS = [
  // ── DriveFurther.API ──────────────────────────────────────────────────────
  { id: 'api', name: 'DriveFurther.API', items: [], children: [
    { id: 'api-modules', name: 'Modules', items: [
      'Activities', 'Admin', 'Claims', 'Communication', 'Documents',
      'Finance', 'Integrations', 'Organisations', 'Policy', 'Products', 'Users', 'Vehicles',
    ], children: [] },
    { id: 'api-services', name: 'Services', items: [
      'BordereauReceipt', 'CreditLookup', 'DocumentProcessing', 'InsuredRisk',
      'Notification', 'PostcodeLookup', 'SagePay', 'SFTPService', 'SOA',
    ], children: [
      { id: 'api-svc-policy', name: 'PolicyManagement', items: ['Commissions'], children: [] },
      { id: 'api-svc-bdrx',   name: 'BordereauxImport',  items: ['PolicyImport', 'ClaimImport'], children: [] },
      { id: 'api-svc-client', name: 'Client',             items: ['FishInsurance'], children: [] },
      { id: 'api-svc-ext',    name: 'ExternalApi',        items: ['CAP', 'CreditSafe', 'DVLA', 'PremiumCredit', 'Sage'], children: [] },
      { id: 'api-svc-intg',   name: 'Integration',        items: ['BxIn'], children: [] },
      { id: 'api-svc-ms',     name: 'MSGraph',             items: ['Exchange', 'OneDrive'], children: [] },
      { id: 'api-svc-wf',     name: 'Workflow',            items: ['Feedback', 'Product'], children: [] },
      { id: 'api-svc-util',   name: 'Utility',             items: [
        'AgreementProcessor', 'FileStore', 'InboundEmailMatcher',
        'LeaseFinanceCalculator', 'ListExporter', 'TemplateProcessor',
      ], children: [] },
    ]},
    { id: 'api-infra', name: 'Infrastructure', items: [
      'Jobs (Hangfire background jobs)',
      'TimeRecorderService (SignalR activity timer)',
      'WindowsService',
    ], children: [] },
  ]},
  // ── DriveFurther.Nucleus ──────────────────────────────────────────────────
  { id: 'nucleus', name: 'DriveFurther.Nucleus', items: [], children: [
    { id: 'nucleus-modules', name: 'modules', items: [
      'vehicle-cap-valuations', 'temporary-vehicles',
      'group-inbox', 'group-calls', 'commission-statement',
      'user-activity', 'user-management',
      'puzzel (Puzzel telephony integration)', 'non-ate-cashbook',
    ], children: [
      { id: 'n-vehicles',   name: 'vehicles',           items: ['vehicle-detail', 'vehicle-dvla', 'vehicle-management'], children: [] },
      { id: 'n-v-leases',   name: 'vehicle-leases',     items: ['vehicle-lease-detail', 'vehicle-lease-financials', 'vehicle-lease-management'], children: [] },
      { id: 'n-v-invoices', name: 'vehicle-invoices',   items: ['lease-invoice-management'], children: [] },
      { id: 'n-v-costs',    name: 'vehicle-costs',      items: ['vehicle-cost-search'], children: [] },
      { id: 'n-v-mid',      name: 'vehicle-mid-entries',items: ['mid-search'], children: [] },
      { id: 'n-contacts',   name: 'contacts',           items: ['company-detail', 'company-region-list', 'contacts-detail'], children: [] },
      { id: 'n-tasks',      name: 'tasks',              items: ['task-status-summary'], children: [] },
      { id: 'n-products',   name: 'products',           items: ['product-detail', 'product-search'], children: [] },
    ]},
    { id: 'nucleus-config', name: 'configuration', items: [
      'scheme', 'coverage', 'activity-types', 'tax-rates', 'sectors',
      'parent-companies', 'policy-status-change-reasons', 'allegation-paragraphs',
      'claim-cost-types', 'vulnerability-types', 'database-audit', 'single-use-actions', 'resources',
    ], children: [
      { id: 'nc-divisions', name: 'divisions', items: ['division-details', 'division-variables'], children: [] },
      { id: 'nc-products',  name: 'products',  items: ['product-type-detail', 'product-category-detail', 'product-option-detail'], children: [] },
      { id: 'nc-docs',      name: 'documents', items: ['document-templates', 'document-types', 'document-pack-definitions', 'document-pack-types', 'email-template'], children: [] },
      { id: 'nc-users',     name: 'users',     items: ['user-list-page', 'user-permissions'], children: [] },
      { id: 'nc-time',      name: 'time',      items: ['time-provider', 'time-amendment-reasons'], children: [] },
      { id: 'nc-vehicles',  name: 'vehicles',  items: ['vehicle-manufacturers', 'vehicle-models', 'vehicle-variants', 'vehicle-colours'], children: [] },
    ]},
    { id: 'nucleus-shared', name: 'solution-shared', items: [
      'policies', 'policy-detail', 'case-activity', 'case-claim', 'claim-detail',
      'service-agreements', 'service-agreement-detail', 'service-agreement-fli-detail',
      'invoice', 'payment', 'note', 'rate-cards', 'non-ate-cashbook',
      'bordereaux-raw-values', 'feedback', 'contact-lookup', 'screen-pop', 'user-activity',
    ], children: [] },
  ]},
]

const STORAGE_KEY = 'nexusmd.projectAreas.v1'

export function useProjectAreas({ storage, getProfileKey }) {
  const key = getProfileKey(STORAGE_KEY)
  const [areas, setAreas] = React.useState(() => {
    try {
      const raw = storage.getItem(key)
      return raw ? JSON.parse(raw) : DEFAULT_PROJECT_AREAS
    } catch {
      return DEFAULT_PROJECT_AREAS
    }
  })

  const isFirstRender = React.useRef(true)
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    try { storage.setItem(key, JSON.stringify(areas)) } catch { /* ignore */ }
  }, [key, areas])

  return [areas, setAreas]
}
