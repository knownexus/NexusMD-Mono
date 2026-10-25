// The profile-key binding lives in @nexusmd/shell-sdk so installable apps can use it without
// importing the shell; this re-export keeps the shell's own imports unchanged.
export { getProfileKey, getActiveProfileId } from '@nexusmd/shell-sdk'
