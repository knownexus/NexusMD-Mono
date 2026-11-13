import { describe, it, expect } from 'vitest'
import {
  normalizeRepoPath, normalizeRemote, repoKeys, resolveRepo, readTarget, linkPage, shortcutTitle, shortcutSub,
  shortcutIcon, linkId, makeLinkWidget, resolveLink, LINK_UNAVAILABLE, newWidgetsAfterSave,
} from '../src/index.js'

const gitFile = (over = {}) => ({
  target: 'git', kind: 'file', path: '/src/app.js',
  repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' }, ...over,
})

describe('normalizeRepoPath', () => {
  it('gives one leading slash and drops empty, dot and dotdot parts', () => {
    expect(normalizeRepoPath('src//app.js')).toBe('/src/app.js')
    expect(normalizeRepoPath('/a/./b/../c/')).toBe('/a/b/c')
    expect(normalizeRepoPath('\\a\\b')).toBe('/a/b')
    expect(normalizeRepoPath('')).toBe('/')
    expect(normalizeRepoPath(undefined)).toBe('/')
  })
})

describe('normalizeRemote', () => {
  it.each([
    ['https://github.com/KnowNexus/Nexus.git', 'github.com/knownexus/nexus'],
    ['git@github.com:knownexus/nexus.git', 'github.com/knownexus/nexus'],
    ['ssh://git@github.com/knownexus/nexus', 'github.com/knownexus/nexus'],
    ['https://user:tok@github.com/knownexus/nexus/', 'github.com/knownexus/nexus'],
    ['https://dev.azure.com/org/My%20Proj/_git/repo', 'dev.azure.com/org/my proj/repo'],
    ['https://org@dev.azure.com/org/proj/_git/repo', 'dev.azure.com/org/proj/repo'],
    ['git@ssh.dev.azure.com:v3/org/proj/repo', 'dev.azure.com/org/proj/repo'],
    ['https://org.visualstudio.com/proj/_git/repo', 'dev.azure.com/org/proj/repo'],
  ])('%s', (url, want) => expect(normalizeRemote(url)).toBe(want))
  it('is empty for anything that is not a remote', () => {
    expect(normalizeRemote('')).toBe('')
    expect(normalizeRemote(null)).toBe('')
    expect(normalizeRemote('nexus')).toBe('')
  })
})

describe('repoKeys', () => {
  it('lists the remote and the provider identity', () => {
    expect(repoKeys({ provider: 'github', name: 'n', fullName: 'O/N', remote: 'git@github.com:o/n.git' })).toEqual(['github.com/o/n', 'github.com/o/n'])
    expect(repoKeys({ provider: 'ado', name: 'R', project: 'P' })).toEqual(['ado:p/r'])
    expect(repoKeys({ provider: 'github', name: 'n', project: 'o' })).toEqual(['github.com/o/n'])
    expect(repoKeys({ provider: 'local', name: 'n' })).toEqual([])
    expect(repoKeys(null)).toEqual([])
  })
})

describe('resolveRepo', () => {
  const gh = { id: 'gh:knownexus/nexus', name: 'nexus', project: 'knownexus', fullName: 'knownexus/nexus', provider: 'github' }
  const ado = { id: '7', name: 'api', project: 'Core', provider: 'ado' }
  const local = { name: 'nexus', path: 'C:\\repos\\nexus', remote: 'git@github.com:knownexus/nexus.git' }

  it('matches a desktop local clone to a GitHub shortcut by remote', () => {
    expect(resolveRepo(gitFile().repo, [ado, local])).toBe(local)
  })
  it('matches a GitHub repo on the phone from a shortcut made with a local remote', () => {
    expect(resolveRepo({ provider: 'local', name: 'nexus', remote: 'https://github.com/knownexus/nexus.git' }, [ado, gh])).toBe(gh)
  })
  it('matches Azure DevOps by project and name, ignoring case', () => {
    expect(resolveRepo({ provider: 'ado', name: 'API', project: 'core' }, [gh, ado])).toBe(ado)
  })
  it('falls back to a name only when exactly one repo has it', () => {
    expect(resolveRepo({ provider: 'local', name: 'API' }, [gh, ado])).toBe(ado)
    expect(resolveRepo({ provider: 'local', name: 'nexus' }, [gh, local])).toBe(null)
  })
  it('is null with nothing to match', () => {
    expect(resolveRepo(gitFile().repo, [])).toBe(null)
    expect(resolveRepo(null, [gh])).toBe(null)
    expect(resolveRepo({ provider: 'github', name: 'other', fullName: 'x/other' }, [gh, ado])).toBe(null)
  })
})

describe('readTarget', () => {
  it('cleans a git target', () => {
    expect(readTarget(gitFile({ path: 'src//app.js', branch: ' dev ', junk: 1 }))).toEqual({
      target: 'git', kind: 'file', path: '/src/app.js', branch: 'dev',
      repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' },
    })
  })
  it('defaults an odd kind to folder and an odd provider to local', () => {
    const t = readTarget({ target: 'git', kind: 'x', path: '/a', repo: { provider: 'svn', name: 'r' } })
    expect(t.kind).toBe('folder')
    expect(t.repo.provider).toBe('local')
  })
  it('reads doc and editor targets', () => {
    expect(readTarget({ target: 'doc', tool: 'json', docId: ' d1 ', name: 'Cfg' })).toEqual({ target: 'doc', tool: 'json', docId: 'd1', name: 'Cfg' })
    expect(readTarget({ target: 'editor', kind: 'file', path: 'C:\\a\\b.txt', platform: 'desktop' })).toEqual({
      target: 'editor', kind: 'file', path: 'C:\\a\\b.txt', name: 'b.txt', platform: 'desktop',
    })
  })
  it('refuses anything unusable', () => {
    for (const bad of [null, 'x', {}, { target: 'nope' }, { target: 'git', path: '/a' }, { target: 'git', repo: { name: '' } },
      { target: 'doc', tool: 'html', docId: 'd' }, { target: 'doc', tool: 'json', docId: '' }, { target: 'editor', path: '' }]) {
      expect(readTarget(bad)).toBe(null)
    }
  })
})

describe('titles, icons and pages', () => {
  it('names a file by its file name, a folder by its folder, the repo root by the repo', () => {
    expect(shortcutTitle(gitFile())).toBe('app.js')
    expect(shortcutTitle(gitFile({ kind: 'folder', path: '/src' }))).toBe('src')
    expect(shortcutTitle(gitFile({ kind: 'folder', path: '/' }))).toBe('nexus')
    expect(shortcutTitle(gitFile({ label: 'Main entry' }))).toBe('Main entry')
    expect(shortcutTitle({ target: 'doc', tool: 'markdown', docId: 'a' })).toBe('Document')
    expect(shortcutTitle({ target: 'doc', tool: 'json', docId: 'a' })).toBe('JSON document')
    expect(shortcutTitle(null)).toBe('Shortcut')
  })
  it('says where it is', () => {
    expect(shortcutSub(gitFile())).toBe('nexus / src')
    expect(shortcutSub(gitFile({ kind: 'folder', path: '/' }))).toBe('nexus')
    expect(shortcutSub({ target: 'doc', tool: 'json', docId: 'a' })).toBe('JSON')
    expect(shortcutSub({ target: 'editor', kind: 'file', path: '/editor/notes/a.md' })).toBe('editor/notes')
  })
  it('picks an icon and a page', () => {
    expect(shortcutIcon(gitFile())).toBe('doc')
    expect(shortcutIcon(gitFile({ kind: 'folder' }))).toBe('folder')
    expect(shortcutIcon(null)).toBe('link')
    expect(linkPage(gitFile())).toBe('git')
    expect(linkPage({ target: 'doc', tool: 'json', docId: 'a' })).toBe('markdown')
    expect(linkPage({ target: 'editor', path: '/x' })).toBe('editor')
    expect(linkPage({})).toBe(null)
  })
})

describe('makeLinkWidget', () => {
  it('makes a link widget with a stable id, so pinning twice replaces', () => {
    const a = makeLinkWidget(gitFile())
    const b = makeLinkWidget(gitFile({ junk: 1 }))
    expect(a).toMatchObject({ type: 'link', config: { target: 'git' } })
    expect(a.id).toMatch(/^lk-/)
    expect(b.id).toBe(a.id)
    expect(newWidgetsAfterSave([a], b)).toHaveLength(1)
  })
  it('gives different targets different ids', () => {
    const ids = [
      linkId(gitFile()), linkId(gitFile({ path: '/src/b.js' })), linkId(gitFile({ branch: 'dev' })),
      linkId({ target: 'doc', tool: 'json', docId: 'a' }), linkId({ target: 'doc', tool: 'markdown', docId: 'a' }),
      linkId({ target: 'editor', path: '/x', platform: 'mobile' }), linkId({ target: 'editor', path: '/x', platform: 'desktop' }),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('gives the same id to a local clone and the GitHub repo it came from', () => {
    const local = gitFile({ repo: { provider: 'local', name: 'nexus', remote: 'git@github.com:knownexus/nexus.git' } })
    expect(linkId(local)).toBe(linkId(gitFile()))
  })
  it('is null for an unusable target', () => {
    expect(makeLinkWidget({ target: 'doc' })).toBe(null)
    expect(linkId(null)).toBe(null)
  })
})

describe('resolveLink', () => {
  const repos = [{ name: 'nexus', provider: 'github', project: 'knownexus', fullName: 'knownexus/nexus', id: 'gh:knownexus/nexus' }]
  const docs = { markdown: [{ id: 'm1' }], json: [{ id: 'j1' }] }

  it('finds the repo for a git target', () => {
    expect(resolveLink(gitFile(), { repos })).toEqual({ ok: true, repo: repos[0] })
    expect(resolveLink(gitFile({ repo: { provider: 'ado', name: 'x', project: 'p' } }), { repos })).toEqual({ ok: false, reason: LINK_UNAVAILABLE.repo })
  })
  it('checks a document is still there, in its own tool', () => {
    expect(resolveLink({ target: 'doc', tool: 'json', docId: 'j1' }, { docs }).ok).toBe(true)
    expect(resolveLink({ target: 'doc', tool: 'json', docId: 'm1' }, { docs })).toEqual({ ok: false, reason: LINK_UNAVAILABLE.doc })
    expect(resolveLink({ target: 'doc', tool: 'markdown', docId: 'm1' }, {})).toEqual({ ok: false, reason: LINK_UNAVAILABLE.doc })
  })
  it('opens an editor path only on the kind of device that made it', () => {
    const t = { target: 'editor', kind: 'file', path: '/editor/a.md', platform: 'mobile' }
    expect(resolveLink(t, { platform: 'mobile' }).ok).toBe(true)
    expect(resolveLink(t, { platform: 'desktop' })).toEqual({ ok: false, reason: LINK_UNAVAILABLE.platform })
  })
  it('reports an incomplete shortcut', () => {
    expect(resolveLink({ target: 'git' }, { repos })).toEqual({ ok: false, reason: LINK_UNAVAILABLE.invalid })
  })
})
