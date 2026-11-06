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

describe('ArtifactDownload plugin: Java and JavaScript agree', () => {
  const java = fs.readFileSync(path.join(javaDir, 'ArtifactDownloadPlugin.java'), 'utf8')
  const js = read('src', 'build-artifacts.js')
  const name = java.match(/@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"/)[1]
  const methods = [...java.matchAll(/@PluginMethod[^\n]*\n\s*public void (\w+)\(PluginCall/g)].map(m => m[1])

  it('registers under the name the JavaScript asks for and implements what it calls', () => {
    expect(js).toContain(`registerPlugin('${name}')`)
    for (const m of new Set([...js.matchAll(/\bplugin\.(\w+)\(/g)].map(x => x[1]))) expect(methods).toContain(m)
  })

  it('is registered by the activity before the bridge starts', () => {
    const at = mainActivity.indexOf('registerPlugin(ArtifactDownloadPlugin.class)')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(mainActivity.search(/^\s*super\.onCreate\(/m))
  })

  it('reads the keys the JavaScript sends and only talks to the two API hosts', () => {
    for (const key of ['url', 'filename', 'headers', 'cancelled', 'bytes']) expect(java).toContain(`"${key}"`)
    expect(java).toContain('"dev.azure.com"')
    expect(java).toContain('"api.github.com"')
  })
})

describe('Google sign-in redirect', () => {
  const oauth = read('src', 'google-oauth.js')
  const scheme = oauth.match(/REDIRECT_SCHEME = '([^']+)'/)[1]

  it('uses the app id as the redirect scheme and the manifest opens the app for it', () => {
    // Google requires an Android client's custom scheme to be the package name.
    expect(scheme).toBe(namespace)
    expect(manifest).toContain(`<data android:scheme="${scheme}" />`)
  })
})

describe('Opening .txt and .md files with the app', () => {
  const java = fs.readFileSync(path.join(javaDir, 'OpenedFilePlugin.java'), 'utf8')
  const js = read('src', 'opened-file.js')
  const name = java.match(/@CapacitorPlugin\(\s*name\s*=\s*"([^"]+)"/)[1]
  const methods = [...java.matchAll(/@PluginMethod[^\n]*\n\s*public void (\w+)\(PluginCall/g)].map(m => m[1])
  const activity = manifest.slice(manifest.indexOf('<activity'), manifest.indexOf('</activity>'))
  const filters = [...activity.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(m => m[1])
  const forFiles = filters.filter(f => /android:mimeType=/.test(f) || /pathPattern/.test(f))

  it('is offered for text and Markdown, when opened (View) and when shared (Send)', () => {
    const text = forFiles.filter(f => /android:mimeType="text\/plain"/.test(f))
    const markdown = forFiles.filter(f => /android:mimeType="text\/markdown"/.test(f))
    for (const group of [text, markdown]) {
      expect(group.length).toBeGreaterThan(0)
      expect(group.some(f => f.includes('android.intent.action.VIEW'))).toBe(true)
      expect(group.some(f => f.includes('android.intent.action.SEND'))).toBe(true)
    }
    expect(forFiles.join('')).toContain('text/x-markdown')
  })

  it('is offered for a .md file a file manager calls a generic file', () => {
    const generic = forFiles.filter(f => /application\/octet-stream/.test(f))
    expect(generic.length).toBeGreaterThan(0)
    // In the XML the pattern's escape is doubled: `.*\\.md` is the pattern `.*\.md`, a literal dot.
    expect(generic.join('')).toMatch(/pathPattern="\.\*\\\\\.md"/)
    expect(generic.join('')).toMatch(/pathPattern="\.\*\\\\\.markdown"/)
  })

  it('every file filter can be picked from a chooser, and only takes content:// addresses', () => {
    for (const f of forFiles) {
      expect(f).toContain('android.intent.category.DEFAULT')
      expect(f).not.toContain('android.intent.category.BROWSABLE') // a web page cannot start it
      if (f.includes('android.intent.action.VIEW')) expect(f).toMatch(/android:scheme="content"/)
      expect(f).not.toMatch(/android:scheme="file"/)
    }
  })

  it('leaves the sign-in redirects as they were', () => {
    expect(activity).toMatch(/android:scheme="nexusmd"[^>]*android:host="oauth"/)
    expect(activity).toMatch(/android:scheme="com\.knownexus\.nexus"/)
  })

  it('registers under the name the JavaScript asks for and implements what it calls', () => {
    expect(js).toContain(`registerPlugin('${name}')`)
    const called = [...new Set([...js.matchAll(/\bplugin\.(\w+)\(/g)].map(x => x[1]))]
    for (const m of called.filter(c => c !== 'addListener')) expect(methods).toContain(m)
  })

  it('tells the page with the event the JavaScript listens for', () => {
    expect(js).toContain("'fileOpened'")
    expect(java).toContain('"fileOpened"')
    for (const key of ['name', 'text', 'error']) expect(java).toContain(`"${key}"`)
  })

  it('is registered by the activity before the bridge starts', () => {
    const at = mainActivity.indexOf('registerPlugin(OpenedFilePlugin.class)')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(mainActivity.search(/^\s*super\.onCreate\(/m))
  })

  it('reads only content:// addresses, never the app\'s own file provider, and caps the size', () => {
    expect(java).toContain('SCHEME_CONTENT')
    expect(java).not.toMatch(/SCHEME_FILE/)
    expect(java).toContain('.fileprovider')
    expect(java).toMatch(/MAX_BYTES\s*=\s*2 \* 1024 \* 1024/)
  })
})
