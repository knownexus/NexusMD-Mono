import React from 'react'

// Open pull requests are listed without the files they change, so their files are read when a file is first
// picked: for the most recently updated ones only, once per repository and refresh, and kept for the session.
const MOST_RECENT = 10
const filesOfPr = new Map()

/** Forgets every pull request's files read so far. */
export function forgetFilePrs() { filesOfPr.clear() }

const firstLine = text => String(text ?? '').split('\n')[0]

/**
 * The open pull requests (`openPRs`: { number, title, lastActivity }) that change `path`, newest first, with
 * the lines each changes in it: [{ number, title, add, del }]. A pull request whose files can't be read is left
 * out. Nothing is read without a path, a client or any pull request.
 */
export function useFilePrs({ client, repo, openPRs, path, refreshKey }) {
  const [files, setFiles] = React.useState(null)
  const recent = React.useMemo(
    () => [...(openPRs ?? [])].sort((a, b) => String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''))).slice(0, MOST_RECENT),
    [openPRs],
  )
  const wanted = path && client && recent.length ? `${repo}#${refreshKey}` : null
  const numbers = recent.map(p => p.number).join(',')
  React.useEffect(() => {
    if (!wanted) { setFiles(null); return undefined }
    let live = true
    const read = async pr => {
      const key = `${wanted}#${pr.number}`
      if (!filesOfPr.has(key)) {
        filesOfPr.set(key, Promise.resolve(client.get(`repos/${repo}/pulls/${pr.number}/files?per_page=100`)).then(list => list ?? [], () => null))
      }
      return [pr.number, await filesOfPr.get(key)]
    }
    Promise.all(recent.map(read)).then(pairs => { if (live) setFiles(new Map(pairs)) })
    return () => { live = false }
  // `recent` is covered by its pull request numbers.
  }, [client, repo, wanted, numbers]) // eslint-disable-line react-hooks/exhaustive-deps
  const prs = React.useMemo(() => {
    if (!files || !path) return []
    return recent.flatMap(pr => {
      const touched = (files.get(pr.number) ?? []).filter(f => f.filename === path)
      if (!touched.length) return []
      return [{ number: pr.number, title: pr.title, add: touched.reduce((n, f) => n + (f.additions ?? 0), 0), del: touched.reduce((n, f) => n + (f.deletions ?? 0), 0) }]
    })
  }, [files, recent, path])
  return { prs, loading: !!wanted && !files }
}

/**
 * The three newest commits that touched `path` on `branch`: [{ sha, subject, date }]. null while loading and a
 * different file's result is never shown for this one; [] when GitHub won't say.
 */
export function useFileCommits({ client, repo, branch, path, refreshKey }) {
  const key = client && path ? `${repo}\0${branch}\0${path}\0${refreshKey}` : null
  const [state, setState] = React.useState({ key: null, commits: null })
  React.useEffect(() => {
    if (!key) return undefined
    let live = true
    Promise.resolve(client.get(`repos/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=3`)).then(
      list => { if (live) setState({ key, commits: (list ?? []).map(c => ({ sha: c.sha, subject: firstLine(c.commit?.message), date: c.commit?.author?.date ?? '' })) }) },
      () => { if (live) setState({ key, commits: [] }) },
    )
    return () => { live = false }
  }, [client, repo, branch, path, key])
  return { commits: state.key === key && key ? state.commits : null }
}
