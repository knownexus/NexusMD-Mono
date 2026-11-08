// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The sideloaded APK (GitHub release, in-app updater) is numbered from the workflow's run number. A build installed from a
// computer with `adb install` for testing has to pick a number of its own, and Android never installs a lower version code over a
// higher one ("INSTALL_FAILED_VERSION_DOWNGRADE", which the installer words as "App not installed as package appears to be
// invalid"). Test builds on devices reached 19 and 20 while releases were 12 and 13, so no release could update them.
const workflow = readFileSync(join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'android-sideload.yml'), 'utf8')

describe('the Android APK release workflow', () => {
  it('numbers the APK well above the run number, so it stays above the test builds put on devices', () => {
    const offset = Number(workflow.match(/VERSION_CODE=\$\(\(\s*RUN_NUMBER\s*\+\s*(\d+)\s*\)\)/)?.[1])
    expect(offset, 'VERSION_CODE=$((RUN_NUMBER + <offset>))').toBeGreaterThanOrEqual(100)
  })

  it('builds with that number, not the bare run number', () => {
    expect(workflow).toMatch(/"-PversionCode=\$VERSION_CODE"/)
    expect(workflow).not.toMatch(/-PversionCode=\$RUN_NUMBER/)
  })
})
