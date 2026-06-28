// confidential.jsx — promoted to @nexusmd/{core,ui}. The pure AES-GCM crypto now
// lives in @nexusmd/core; the storage/pref-sync wrappers live in @nexusmd/ui
// (namespaced via the planner runtime). Re-exported here so existing web import
// paths keep working.
export {
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
  loadConfidentialConfig, saveConfidentialConfig,
} from '@nexusmd/ui'
