import { HttpError } from '../http/errors.js'
import { outbound, outboundJson, outboundText } from './outbound.js'

export interface JenkinsConnection {
  baseUrl: string
  username: string | null
  secret: string
  /** Company CA certificate(s) to trust, PEM. */
  ca?: string | null
}

export interface JenkinsBuild {
  number: number
  result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | 'NOT_BUILT' | null
  building: boolean
  url: string
  timestamp: number
  duration: number
  /** First HTML artifact, if any (used for report URLs). */
  reportUrl: string | null
}

const SERVICE = 'Jenkins'

function headers(c: JenkinsConnection): Record<string, string> {
  if (!c.username) throw new HttpError(422, 'Jenkins needs a user name.', 'invalid')
  return { authorization: `Basic ${Buffer.from(`${c.username}:${c.secret}`).toString('base64')}` }
}

/**
 * Accepts "folder/sub/job", "job/folder/job/sub/job/job" or a full job URL
 * under the Jenkins base URL; returns the plain path "folder/sub/job".
 */
export function normalizeJobPath(input: string, baseUrl: string): string {
  let path = input.trim()
  if (/^https?:\/\//i.test(path)) {
    if (!path.toLowerCase().startsWith(baseUrl.toLowerCase())) {
      throw new HttpError(422, 'That job URL is not on the connected Jenkins.', 'invalid')
    }
    path = path.slice(baseUrl.length)
  }
  const segments = path
    .split('/')
    .map((s) => decodeURIComponent(s.trim()))
    .filter((s) => s && s !== 'job')
  if (segments.length === 0) throw new HttpError(422, 'Enter a job name or path.', 'invalid')
  if (segments.some((s) => s === '..' || s === '.')) throw new HttpError(422, 'Invalid job path.', 'invalid')
  return segments.join('/')
}

export function jobUrl(c: JenkinsConnection, jobPath: string): string {
  return `${c.baseUrl}/${jobPath
    .split('/')
    .map((s) => `job/${encodeURIComponent(s)}`)
    .join('/')}`
}

/** Verifies credentials; returns the Jenkins version when advertised. */
export async function jenkinsWhoAmI(c: JenkinsConnection): Promise<string> {
  const res = await outbound(`${c.baseUrl}/api/json?tree=mode`, SERVICE, { headers: headers(c), ca: c.ca })
  await res.text()
  return res.headers.get('x-jenkins') ? `Jenkins ${res.headers.get('x-jenkins')}` : 'Jenkins'
}

interface RawBuild {
  number: number
  result: JenkinsBuild['result']
  building?: boolean
  url: string
  timestamp: number
  duration: number
  artifacts?: { relativePath: string }[]
}

export async function jenkinsBuilds(c: JenkinsConnection, jobPath: string, limit = 10): Promise<JenkinsBuild[]> {
  const tree = `builds[number,result,building,url,timestamp,duration,artifacts[relativePath]]{0,${limit}}`
  const job = await outboundJson<{ builds?: RawBuild[] }>(`${jobUrl(c, jobPath)}/api/json?tree=${encodeURIComponent(tree)}`, SERVICE, {
    headers: headers(c),
    ca: c.ca,
  })
  return (job.builds ?? []).map((b) => {
    const html = b.artifacts?.find((a) => /\.html?$/i.test(a.relativePath))
    const url = b.url.endsWith('/') ? b.url : `${b.url}/`
    return {
      number: b.number,
      result: b.result ?? null,
      building: b.building === true,
      url,
      timestamp: b.timestamp,
      duration: b.duration,
      reportUrl: html ? `${url}artifact/${html.relativePath.split('/').map(encodeURIComponent).join('/')}` : null,
    }
  })
}

/**
 * Starts a build. Parameters are sent only if any are given. Returns the
 * queue item URL Jenkins gives back (to find the build it becomes), if any.
 */
export async function jenkinsTrigger(c: JenkinsConnection, jobPath: string, parameters: Record<string, string>): Promise<string | null> {
  const hasParams = Object.keys(parameters).length > 0
  const url = `${jobUrl(c, jobPath)}/${hasParams ? `buildWithParameters?${new URLSearchParams(parameters)}` : 'build'}`
  const res = await outbound(url, SERVICE, { method: 'POST', headers: headers(c), ca: c.ca, errorDetail: true })
  await res.text()
  const location = res.headers.get('location')
  return location && /\/queue\/item\/\d+\/?$/.test(location) ? location.replace(/\/?$/, '/') : null
}

export type QueueState = { state: 'waiting'; why: string | null } | { state: 'started'; number: number } | { state: 'cancelled' } | { state: 'gone' }

/** What became of a queued build: still waiting, started (#n), cancelled, or forgotten by Jenkins. */
export async function jenkinsQueueItem(c: JenkinsConnection, queueUrl: string): Promise<QueueState> {
  // Only ask the connected Jenkins (the URL came from its Location header).
  if (new URL(queueUrl).host !== new URL(c.baseUrl).host) throw new HttpError(422, 'Queue item is not on the connected Jenkins.', 'invalid')
  try {
    const q = await outboundJson<{ cancelled?: boolean; why?: string | null; executable?: { number?: number } | null }>(
      `${queueUrl}api/json?tree=cancelled,why,executable[number]`,
      SERVICE,
      { headers: headers(c), ca: c.ca },
    )
    if (q.executable?.number) return { state: 'started', number: q.executable.number }
    if (q.cancelled) return { state: 'cancelled' }
    return { state: 'waiting', why: q.why ?? null }
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { state: 'gone' }
    throw err
  }
}

/** Replaces {{version}} / {{name}} in parameter values. */
export function applyTemplate(params: Record<string, string>, release: { name: string; version: string }) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, v.replaceAll('{{version}}', release.version).replaceAll('{{name}}', release.name)]),
  )
}

// --- Followed builds: one run and everything it started --------------------------------

/** Build "numbers" Jenkins resolves itself (permalinks). */
const PERMALINKS = ['lastBuild', 'lastSuccessfulBuild', 'lastFailedBuild', 'lastCompletedBuild', 'lastStableBuild', 'lastUnstableBuild', 'lastUnsuccessfulBuild']

export interface BuildRef {
  jobPath: string
  /** A build number, a permalink such as "lastBuild", or null (none given: the latest build). */
  build: number | string | null
}

/**
 * Reads a pasted Jenkins link: a build (…/job/a/job/b/42/, with anything after
 * it such as /console), a job (its latest build), or a Blue Ocean link
 * (…/blue/organizations/jenkins/a%2Fb/detail/b/42/pipeline). It must be on the
 * connected Jenkins.
 */
export function parseBuildUrl(input: string, baseUrl: string): BuildRef {
  const raw = input.trim()
  if (!/^https?:\/\//i.test(raw)) throw new HttpError(422, 'Paste the full link of the build from Jenkins.', 'invalid')
  let url: URL
  let base: URL
  try {
    url = new URL(raw)
    base = new URL(baseUrl)
  } catch {
    throw new HttpError(422, 'That is not a valid link.', 'invalid')
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  if (url.host.toLowerCase() !== base.host.toLowerCase() || !(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))) {
    throw new HttpError(422, `That link is not on the connected Jenkins (${base.host}${basePath}).`, 'invalid')
  }
  const segments = url.pathname
    .slice(basePath.length)
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))

  // Blue Ocean: /blue/organizations/jenkins/<full name, / as %2F>/detail/<branch or name>/<n>/…
  if (segments[0] === 'blue') {
    const at = segments.indexOf('jenkins')
    const pipeline = segments[at + 1]
    if (at < 0 || !pipeline) throw new HttpError(422, 'Open the build in the classic Jenkins page and paste that link.', 'invalid')
    const parts = pipeline.split('/').filter(Boolean)
    const detail = segments.indexOf('detail')
    const branch = detail >= 0 ? segments[detail + 1] : undefined
    // Multibranch pipelines put the branch after /detail/.
    if (branch && branch !== parts.at(-1)) parts.push(branch)
    const n = detail >= 0 ? Number(segments[detail + 2]) : NaN
    return checked({ jobPath: parts.join('/'), build: Number.isInteger(n) && n > 0 ? n : null })
  }

  const names: string[] = []
  let i = 0
  while (segments[i] === 'job' && segments[i + 1]) {
    names.push(segments[i + 1]!)
    i += 2
  }
  if (names.length === 0) throw new HttpError(422, 'Paste the link of a job or build (it contains /job/…).', 'invalid')
  const next = segments[i]
  const n = Number(next)
  const build = next && /^\d+$/.test(next) && n > 0 ? n : next && PERMALINKS.includes(next) ? next : null
  return checked({ jobPath: names.join('/'), build })
}

function checked(ref: BuildRef): BuildRef {
  if (!ref.jobPath || ref.jobPath.split('/').some((s) => s === '..' || s === '.')) throw new HttpError(422, 'Invalid job path.', 'invalid')
  return ref
}

export const buildUrl = (c: JenkinsConnection, jobPath: string, build: number | string) => `${jobUrl(c, jobPath)}/${build}/`

export interface BuildNode {
  jobPath: string
  /** Null while the build is still waiting in Jenkins' queue. */
  number: number | null
  name: string
  url: string
  result: JenkinsBuild['result']
  building: boolean
  queued: boolean
  timestamp: number | null
  duration: number | null
  estimatedDuration: number | null
  /** First HTML artifact (a test report), if any. */
  reportUrl?: string | null
  /** Builds this one started (downstream), when Jenkins reports them. */
  children: BuildNode[]
  error?: string
}

interface RawBuildDetail extends RawBuild {
  fullDisplayName?: string
  estimatedDuration?: number
  actions?: Array<{
    downstreamBuilds?: Array<{ jobFullName?: string; buildNumber?: number | null }>
    triggeredBuilds?: Array<{ number?: number; url?: string }>
  } | null>
  subBuilds?: Array<{ jobName?: string; buildNumber?: number; url?: string }>
}

const DETAIL_TREE = [
  'number,result,building,url,timestamp,duration,estimatedDuration,fullDisplayName,artifacts[relativePath]',
  // Pipeline "build" steps, the Parameterized Trigger plugin, the MultiJob plugin.
  'actions[downstreamBuilds[jobFullName,buildNumber],triggeredBuilds[number,url]]',
  'subBuilds[jobName,buildNumber,url]',
].join(',')

const MAX_DEPTH = 3
const MAX_NODES = 40

/** The build with its status and, recursively, the builds it started. */
export async function jenkinsBuildTree(c: JenkinsConnection, ref: { jobPath: string; build: number | string }): Promise<BuildNode> {
  const budget = { nodes: MAX_NODES }
  return node(c, ref.jobPath, ref.build, 0, budget, new Set())
}

/** Resolves a permalink/"latest" to an actual build number. */
export async function resolveBuildNumber(c: JenkinsConnection, ref: BuildRef): Promise<number> {
  if (typeof ref.build === 'number') return ref.build
  const b = await outboundJson<{ number?: number }>(`${buildUrl(c, ref.jobPath, ref.build ?? 'lastBuild')}api/json?tree=number`, SERVICE, {
    headers: headers(c),
    ca: c.ca,
  })
  if (!b.number) throw new HttpError(422, 'That job has no builds yet.', 'invalid')
  return b.number
}

async function node(
  c: JenkinsConnection,
  jobPath: string,
  build: number | string,
  depth: number,
  budget: { nodes: number },
  seen: Set<string>,
): Promise<BuildNode> {
  budget.nodes--
  const url = buildUrl(c, jobPath, build)
  seen.add(`${jobPath}#${build}`)
  const raw = await outboundJson<RawBuildDetail>(`${url}api/json?tree=${encodeURIComponent(DETAIL_TREE)}`, SERVICE, { headers: headers(c), ca: c.ca })
  const selfUrl = raw.url?.endsWith('/') ? raw.url : raw.url ? `${raw.url}/` : url
  const html = raw.artifacts?.find((a) => /\.html?$/i.test(a.relativePath))
  const self: BuildNode = {
    jobPath,
    number: raw.number,
    name: raw.fullDisplayName ?? `${jobPath} #${raw.number}`,
    url: selfUrl,
    reportUrl: html ? `${selfUrl}artifact/${html.relativePath.split('/').map(encodeURIComponent).join('/')}` : null,
    result: raw.result ?? null,
    building: raw.building === true,
    queued: false,
    timestamp: raw.timestamp ?? null,
    duration: raw.duration ?? null,
    estimatedDuration: raw.estimatedDuration && raw.estimatedDuration > 0 ? raw.estimatedDuration : null,
    children: [],
  }
  if (depth >= MAX_DEPTH) return self

  let refs = downstreamRefs(c, raw)
  if (refs.length === 0) refs = await consoleRefs(c, self.url)
  refs = refs.filter((r) => !seen.has(`${r.jobPath}#${r.number}`))
  for (const r of refs) seen.add(`${r.jobPath}#${r.number}`)

  const children: BuildNode[] = []
  // A few at a time: be gentle with Jenkins.
  const queue = [...refs]
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      if (r.number === null) {
        children.push(queuedNode(c, r.jobPath))
        continue
      }
      if (budget.nodes <= 0) continue
      try {
        children.push(await node(c, r.jobPath, r.number, depth + 1, budget, seen))
      } catch (err) {
        children.push({ ...queuedNode(c, r.jobPath), number: r.number, queued: false, name: `${r.jobPath} #${r.number}`, url: buildUrl(c, r.jobPath, r.number), error: (err as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, refs.length) }, worker))
  // Keep Jenkins' order (workers finish in any order).
  self.children = refs
    .map((r) => children.find((ch) => ch.jobPath === r.jobPath && ch.number === r.number))
    .filter((ch): ch is BuildNode => !!ch)
  return self
}

function queuedNode(c: JenkinsConnection, jobPath: string): BuildNode {
  return {
    jobPath,
    number: null,
    name: `${jobPath} (waiting in queue)`,
    url: `${jobUrl(c, jobPath)}/`,
    result: null,
    building: false,
    queued: true,
    timestamp: null,
    duration: null,
    estimatedDuration: null,
    children: [],
  }
}

type ChildRef = { jobPath: string; number: number | null }

/** Downstream builds from the build's own data (plugins that record them). */
function downstreamRefs(c: JenkinsConnection, raw: RawBuildDetail): ChildRef[] {
  const refs: ChildRef[] = []
  for (const action of raw.actions ?? []) {
    for (const d of action?.downstreamBuilds ?? []) {
      if (d.jobFullName) refs.push({ jobPath: d.jobFullName, number: d.buildNumber ?? null })
    }
    for (const t of action?.triggeredBuilds ?? []) {
      const ref = t.url ? refFromUrl(c, t.url) : null
      if (ref) refs.push({ jobPath: ref.jobPath, number: t.number ?? ref.number })
    }
  }
  for (const s of raw.subBuilds ?? []) {
    const ref = s.url ? refFromUrl(c, s.url) : null
    if (ref) refs.push({ jobPath: ref.jobPath, number: s.buildNumber ?? ref.number })
    else if (s.jobName && s.buildNumber) refs.push({ jobPath: s.jobName, number: s.buildNumber })
  }
  return dedupe(refs)
}

/** "…/job/a/job/b/12/" (absolute, root-relative or base-relative) → a/b #12. */
function refFromUrl(c: JenkinsConnection, href: string): ChildRef | null {
  try {
    const base = new URL(`${c.baseUrl}/`)
    const url = new URL(href, href.startsWith('/') ? base.origin : base)
    if (url.host !== base.host) return null
    const m = /((?:\/job\/[^/]+)+)\/(\d+)\/?$/.exec(url.pathname)
    if (!m) return null
    const jobPath = m[1]!
      .split('/job/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s))
      .join('/')
    return { jobPath, number: Number(m[2]) }
  } catch {
    return null
  }
}

/**
 * Fallback: builds the console log says were started ("Starting building:",
 * "Triggering a new build of", "… completed. Result was …"). Reads the HTML
 * log because it links each build.
 */
async function consoleRefs(c: JenkinsConnection, buildPageUrl: string): Promise<ChildRef[]> {
  let html: string
  try {
    html = (await outboundText(`${buildPageUrl}logText/progressiveHtml`, SERVICE, { headers: { ...headers(c), accept: 'text/html' }, ca: c.ca })).text
  } catch {
    return []
  }
  const refs: ChildRef[] = []
  for (const line of html.split(/\r?\n/)) {
    if (!/Starting building|Triggering a new build|Build .* started|completed\. Result was|Scheduling project/i.test(line)) continue
    for (const m of line.matchAll(/href=['"]([^'"]+)['"]/g)) {
      const ref = refFromUrl(c, m[1]!.replace(/&amp;/g, '&'))
      if (ref) refs.push(ref)
    }
  }
  return dedupe(refs)
}

function dedupe(refs: ChildRef[]): ChildRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const key = `${r.jobPath}#${r.number}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A page from the connected Jenkins (e.g. a build's HTML report), as text. */
export async function jenkinsGetText(c: JenkinsConnection, url: string): Promise<string> {
  if (new URL(url).host !== new URL(c.baseUrl).host) throw new HttpError(422, 'That report is not on the connected Jenkins.', 'invalid')
  return (await outboundText(url, SERVICE, { headers: { ...headers(c), accept: 'text/html,*/*' }, ca: c.ca, errorDetail: true })).text
}

/**
 * A report page: from Jenkins with its credentials, or — for reports Jenkins
 * serves from another address (its "Resource Root URL", whose links need no
 * login) — fetched without any credentials, so they never leave Jenkins.
 */
export async function reportGetText(c: JenkinsConnection, url: string): Promise<string> {
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new HttpError(422, 'Use an http(s) link.', 'invalid')
  if (target.host === new URL(c.baseUrl).host) return jenkinsGetText(c, url)
  return (await outboundText(url, 'The report server', { headers: { accept: 'text/html,*/*' }, ca: c.ca, errorDetail: true })).text
}
