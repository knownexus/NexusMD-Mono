import { describe, it, expect } from 'vitest'
import {
  normalizeRepoPath, normalizeRemote, remoteFromRemotes, repoKeys, githubRepoOf, cloneRepoIdentity, savedDocIds, savedDocList, childrenAt, resolveRepo, readTarget, targetPlace, linkPage, shortcutTitle, shortcutSub,
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
    ['https://user:p@ss@github.com/knownexus/nexus', 'github.com/knownexus/nexus'],
    ['https://ghp_abc123@github.com/knownexus/nexus.git', 'github.com/knownexus/nexus'],
    ['ghp_abc123@github.com:knownexus/nexus.git', 'github.com/knownexus/nexus'],
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

describe('remoteFromRemotes', () => {
  it('prefers origin, drops credentials, and falls back to the first remote', () => {
    const text = 'fork\thttps://github.com/me/nexus.git (fetch)\nfork\thttps://github.com/me/nexus.git (push)\norigin\thttps://u:tok@github.com/knownexus/nexus.git (fetch)\norigin\thttps://u:tok@github.com/knownexus/nexus.git (push)\n'
    expect(remoteFromRemotes(text)).toBe('github.com/knownexus/nexus')
    expect(remoteFromRemotes('fork\tgit@github.com:me/nexus.git (fetch)\r\nfork\tgit@github.com:me/nexus.git (push)\r\n')).toBe('github.com/me/nexus')
  })
  it('is empty when there is no usable remote', () => {
    expect(remoteFromRemotes('')).toBe('')
    expect(remoteFromRemotes(undefined)).toBe('')
    expect(remoteFromRemotes('origin\tC:\\local\\copy (fetch)')).toBe('')
    expect(remoteFromRemotes('not a listing')).toBe('')
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

describe('githubRepoOf', () => {
  it('is owner/name for a GitHub repo, as written', () => {
    expect(githubRepoOf({ provider: 'github', name: 'nexus', fullName: 'KnownExus/Nexus' })).toBe('KnownExus/Nexus')
  })
  it('reads it from a GitHub remote of a local clone', () => {
    expect(githubRepoOf({ provider: 'local', name: 'n', remote: 'git@github.com:knownexus/nexus.git' })).toBe('knownexus/nexus')
  })
  it('is empty for anything not on GitHub', () => {
    expect(githubRepoOf({ provider: 'ado', name: 'n', project: 'p' })).toBe('')
    expect(githubRepoOf({ provider: 'local', name: 'n', remote: 'https://gitlab.com/o/n.git' })).toBe('')
    expect(githubRepoOf({ provider: 'github', name: 'n', fullName: 'bad' })).toBe('')
    expect(githubRepoOf(null)).toBe('')
  })
})

describe('cloneRepoIdentity', () => {
  it('names a clone of a GitHub repository by owner and name, whatever its folder is called', () => {
    expect(cloneRepoIdentity({ name: 'my-checkout', remote: 'github.com/knownexus/nexus' })).toEqual({
      provider: 'github', name: 'nexus', fullName: 'knownexus/nexus', remote: 'github.com/knownexus/nexus',
    })
  })
  it('names any other clone by its folder and remote', () => {
    expect(cloneRepoIdentity({ name: 'api', remote: 'dev.azure.com/org/core/api' })).toEqual({ provider: 'local', name: 'api', remote: 'dev.azure.com/org/core/api' })
  })
  it('names a clone with no remote by its folder alone', () => {
    expect(cloneRepoIdentity({ name: 'scratch' })).toEqual({ provider: 'local', name: 'scratch' })
    expect(cloneRepoIdentity({ name: 'scratch', remote: '' })).toEqual({ provider: 'local', name: 'scratch' })
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
  it('matches a desktop clone of an Azure DevOps repo to the phone’s listing of it by project and name', () => {
    const clone = { provider: 'local', name: 'whatever-the-folder-is-called', remote: 'https://org@dev.azure.com/org/Core/_git/api' }
    expect(resolveRepo(clone, [gh, ado])).toBe(ado)
    expect(repoKeys(clone)).toContain('ado:core/api')
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
  it('keeps only the normalized remote, never credentials from the URL', () => {
    const t = readTarget(gitFile({ repo: { provider: 'github', name: 'nexus', remote: 'https://me:s3cret@github.com/KnownExus/Nexus.git' } }))
    expect(t.repo.remote).toBe('github.com/knownexus/nexus')
    expect(JSON.stringify(t)).not.toMatch(/s3cret|me:/)
    expect(readTarget(gitFile({ repo: { provider: 'github', name: 'n', remote: 'not a remote' } })).repo).not.toHaveProperty('remote')
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

describe('savedDocList', () => {
  it('names each document by the name it was given, else the one it was named after', () => {
    expect(savedDocList({ docs: [
      { id: 'a', name: 'Plan', autoName: 'Auto', updatedAt: 5 },
      { id: 'b', name: null, autoName: 'Auto B' },
      { id: 'c' },
    ] })).toEqual([
      { id: 'a', name: 'Plan', updatedAt: 5 },
      { id: 'b', name: 'Auto B', updatedAt: 0 },
      { id: 'c', name: '', updatedAt: 0 },
    ])
  })
  it('reads the bare list of the JSON store, and survives rubbish', () => {
    expect(savedDocList(JSON.stringify([{ id: 'j', autoName: 'cfg', updatedAt: '9' }]))).toEqual([{ id: 'j', name: 'cfg', updatedAt: 9 }])
    expect(savedDocList('{nope')).toEqual([])
    expect(savedDocList(null)).toEqual([])
  })
})

describe('childrenAt', () => {
  const files = ['README.md', 'src/app.js', 'src/lib/a.js', 'src/lib/b.js', 'docs/guide.md', 'srcfile.txt']
  it('lists the folders first, then the files, by name', () => {
    expect(childrenAt(files, '/')).toEqual([
      { name: 'docs', path: '/docs', isFolder: true },
      { name: 'src', path: '/src', isFolder: true },
      { name: 'README.md', path: '/README.md', isFolder: false },
      { name: 'srcfile.txt', path: '/srcfile.txt', isFolder: false },
    ])
  })
  it('lists one folder’s own children, not a sibling that starts with the same letters', () => {
    expect(childrenAt(files, '/src')).toEqual([
      { name: 'lib', path: '/src/lib', isFolder: true },
      { name: 'app.js', path: '/src/app.js', isFolder: false },
    ])
    expect(childrenAt(files, 'src/lib/')).toEqual([
      { name: 'a.js', path: '/src/lib/a.js', isFolder: false },
      { name: 'b.js', path: '/src/lib/b.js', isFolder: false },
    ])
  })
  it('is empty for a folder with nothing in it, or nothing to look in', () => {
    expect(childrenAt(files, '/nope')).toEqual([])
    expect(childrenAt([], '/')).toEqual([])
    expect(childrenAt(undefined)).toEqual([])
    expect(childrenAt(['', null, 'a.js'], '/')).toEqual([{ name: 'a.js', path: '/a.js', isFolder: false }])
  })
})

describe('savedDocIds', () => {
  it('reads both store shapes, from text or already parsed', () => {
    expect(savedDocIds(JSON.stringify({ docs: [{ id: 'a', name: 'A' }, { id: 'b' }] }))).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(savedDocIds(JSON.stringify([{ id: 'j1', content: '{}' }]))).toEqual([{ id: 'j1' }])
    expect(savedDocIds({ docs: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
    expect(savedDocIds([{ id: 'a' }])).toEqual([{ id: 'a' }])
  })
  it('leaves out anything that is not a document with an id', () => {
    expect(savedDocIds([null, 3, 'x', {}, { id: '' }, { id: 7 }, { id: 'ok' }])).toEqual([{ id: 'ok' }])
  })
  it('has none for an empty, missing or unreadable store', () => {
    expect(savedDocIds(null)).toEqual([])
    expect(savedDocIds(undefined)).toEqual([])
    expect(savedDocIds('')).toEqual([])
    expect(savedDocIds('{not json')).toEqual([])
    expect(savedDocIds('{"docs": 4}')).toEqual([])
  })
})

describe('targetPlace', () => {
  it('opens a file inside its own folder, and a folder as itself', () => {
    expect(targetPlace(gitFile())).toEqual({ path: '/src', file: '/src/app.js' })
    expect(targetPlace(gitFile({ path: '/README.md' }))).toEqual({ path: '/', file: '/README.md' })
    expect(targetPlace(gitFile({ kind: 'folder', path: '/src/lib' }))).toEqual({ path: '/src/lib', file: null })
    expect(targetPlace(gitFile({ kind: 'folder', path: '/' }))).toEqual({ path: '/', file: null })
  })
  it('is null for anything that is not a git target', () => {
    expect(targetPlace({ target: 'doc', tool: 'json', docId: 'a' })).toBe(null)
    expect(targetPlace(null)).toBe(null)
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
