# Android E2E (Appium)

Smoke tests for the Capacitor/Android build, driven by Appium + the UiAutomator2 driver.
These require an Android emulator (or device) and a built debug APK, so they run in a
dedicated nightly CI job (with a KVM-enabled runner), **not** in the default unit/build pipeline.

## Prerequisites
- Android SDK + an emulator image (e.g. `system-images;android-34;google_apis;x86_64`)
- Appium 2 + driver: `npm i -g appium && appium driver install uiautomator2`
- A debug APK: `npm -w apps/app run build && npx cap sync android && (cd apps/app/android && ./gradlew assembleDebug)`

## Run locally
```bash
# 1. start an emulator and Appium server
appium
# 2. point APPIUM_APK at the built apk, then:
npm -w apps/app run e2e:android
```

## Files
- `wdio.conf.js` — WebdriverIO + Appium capabilities (created when wiring the nightly job)
- `specs/smoke.e2e.js` — launch app, assert the first view renders

The web/desktop surfaces are covered by Playwright today; Android is the remaining
surface and is gated on emulator infrastructure in CI.
