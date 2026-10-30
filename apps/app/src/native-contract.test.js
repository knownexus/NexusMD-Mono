// Things that stop the app launching or the native bridge working, and that no JavaScript test
// would otherwise notice: the Android project, the Capacitor config and the Java plugin have to
// agree with each other and with the web code that calls them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const APP = path.resolve(import.meta.dirname, '..')
const ANDROID = path.join(APP, 'android')
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8')
const pkg = JSON.parse(read('package.json'))

const manifest = read('android', 'app', 'src', 'main', 'AndroidManifest.xml')
const gradle = read('android', 'app', 'build.gradle')
const namespace = gradle.match(/namespace\s*=?\s*"([^"]+)"/)[1]
const javaDir = path.join(ANDROID, 'app', 'src', 'main', 'java', ...namespace.split('.'))
const pluginJava = fs.readFileSync(path.join(javaDir, 'SafFolderPlugin.java'), 'utf8')
const mainActivity = fs.readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8')

describe('Android project', () => {
  it('has the launcher activity in the app namespace', () => {
    // The manifest says ".MainActivity", which Android resolves against the namespace; a class in
    // any other package fails at launch with ClassNotFoundException.
    expect(manifest).toMatch(/android:name="\.MainActivity"/)
    expect(mainActivity).toMatch(new RegExp(`^package ${namespace.replace(/\./g, '\\.')};`, 'm'))
    expect(mainActivity).toMatch(/extends BridgeActivity/)
  })

  it('uses one application id everywhere', () => {
    expect(gradle).toMatch(new RegExp(`applicationId\\s*=?\\s*"${namespace.replace(/\./g, '\\.')}"`))
    expect(JSON.parse(read('capacitor.config.json')).appId).toBe(namespace)
  })

  it('declares the launcher intent, the network permission and the OAuth deep link', () => {
    expect(manifest).toContain('android.intent.action.MAIN')
    expect(manifest).toContain('android.intent.category.LAUNCHER')
    expect(manifest).toContain('android.permission.INTERNET')
    expect(manifest).toMatch(/android:scheme="nexusmd"[^>]*android:host="oauth"/)
    // Android 12+ refuses to install an app whose intent-filter activity does not say exported.
    expect(manifest).toMatch(/android:exported="true"/)
  })

  it('serves the web build Capacitor copies in', () => {
    const cfg = JSON.parse(read('capacitor.config.json'))
    const vite = read('vite.config.js')
    expect(vite).toContain(`outDir: '${cfg.webDir}'`)
  })

  it('only configures signing when keystore.properties exists', () => {
    // An unguarded file(keystoreProperties['storeFile']) throws while Gradle configures, which
    // breaks every build (debug and CI included) on a machine without the keystore.
    const signing = gradle.slice(gradle.indexOf('signingConfigs'), gradle.indexOf('buildTypes'))
    expect(signing).toContain('keystorePropertiesFile.exists()')
    const release = gradle.slice(gradle.indexOf('buildTypes'))
    expect(release).toMatch(/if \(keystorePropertiesFile\.exists\(\)\) \{\s*signingConfig signingConfigs\.release/)
  })

  it('has an executable Gradle wrapper in git', () => {
    // Without the executable bit, ./gradlew fails with "Permission denied" on Linux and macOS (CI).
    let line
    try {
      line = execFileSync('git', ['ls-files', '-s', 'android/gradlew'], { cwd: APP, encoding: 'utf8' }).trim()
    } catch { return } // not a git checkout (a source tarball)
    if (line) expect(line.startsWith('100755')).toBe(true)
  })
})

describe('Capacitor versions', () => {
  const major = v => Number(String(v).replace(/^[^\d]*/, '').split('.')[0])
  const all = { ...pkg.dependencies, ...pkg.devDependencies }

  it('uses one major for core, android and the CLI', () => {
    expect(new Set([all['@capacitor/core'], all['@capacitor/android'], all['@capacitor/cli']].map(major)).size).toBe(1)
  })

  it('uses plugins of that major', () => {
    const core = major(all['@capacitor/core'])
    for (const [name, v] of Object.entries(all)) if (name.startsWith('@capacitor/') && name !== '@capacitor/cli') expect([name, major(v)]).toEqual([name, core])
  })
})

describe('SafFolder plugin: Java and JavaScript agree', () => {
  const js = read('src', 'adapters', 'editor-saf.js')
  const javaName = pluginJava.match(/@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"/)[1]
  const javaMethods = [...pluginJava.matchAll(/@PluginMethod[^\n]*\n\s*public void (\w+)\(PluginCall/g)].map(m => m[1])

  it('registers under the name the JavaScript asks for', () => {
    expect(js).toContain(`registerPlugin('${javaName}')`)
  })

  it('implements every method the JavaScript calls', () => {
    const called = [...new Set([...js.matchAll(/\bplugin\.(\w+)\(/g)].map(m => m[1]))]
    expect(called.length).toBeGreaterThan(0)
    for (const m of called) expect(javaMethods).toContain(m)
  })

  it('is registered by the activity before the bridge starts', () => {
    const registerAt = mainActivity.indexOf('registerPlugin(SafFolderPlugin.class)')
    expect(registerAt).toBeGreaterThan(-1)
    // Local plugins have to be registered before super.onCreate builds the bridge.
    expect(registerAt).toBeLessThan(mainActivity.search(/^\s*super\.onCreate\(/m))
  })

  it('reads the keys the JavaScript sends', () => {
    for (const key of ['tree', 'path', 'text']) expect(pluginJava).toContain(`"${key}"`)
    for (const key of ['uri', 'name', 'cancelled']) expect(pluginJava).toContain(`"${key}"`)
  })
})
