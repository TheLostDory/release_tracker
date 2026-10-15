import { HttpError } from '../http/errors.js'
import { outbound, outboundJson } from './outbound.js'

export interface JenkinsConnection {
  baseUrl: string
  username: string | null
  secret: string
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
  const res = await outbound(`${c.baseUrl}/api/json?tree=mode`, SERVICE, { headers: headers(c) })
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

/** Starts a build. Parameters are sent only if any are given. */
export async function jenkinsTrigger(c: JenkinsConnection, jobPath: string, parameters: Record<string, string>): Promise<void> {
  const hasParams = Object.keys(parameters).length > 0
  const url = `${jobUrl(c, jobPath)}/${hasParams ? `buildWithParameters?${new URLSearchParams(parameters)}` : 'build'}`
  const res = await outbound(url, SERVICE, { method: 'POST', headers: headers(c) })
  await res.text()
}

/** Replaces {{version}} / {{name}} in parameter values. */
export function applyTemplate(params: Record<string, string>, release: { name: string; version: string }) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, v.replaceAll('{{version}}', release.version).replaceAll('{{name}}', release.name)]),
  )
}
