/**
 * Failed test cases from an HTML test report (HIT, Load Test…). Reports
 * differ, so this tries the usual layouts; a project can give its own
 * pattern instead. Pure (tested).
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The report as plain text, one line per block element (for line-based patterns). */
export function linesOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(tr|p|div|li|h[1-6]|pre)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const FAIL_WORD = /^(fail|failed|failure|failing|error|errored|broken|ko|nok|✗|✘|❌)$/i
const NOT_A_NAME = /^(fail|failed|failure|failing|error|errored|broken|ko|nok|pass|passed|ok|success|skipped|✗|✘|❌|✓|✔|-|n\/a)$/i
const NUMERIC = /^[\d\s.,:%]+(ms|s|sec|secs|min|m|h)?$/i

const MAX_TESTS = 100

/**
 * Failed test names. With `pattern` (a regular expression, first group =
 * the name) only that is used; otherwise: table rows marked failed, then
 * elements with a "fail"/"error" class, then lines like "FAILED: name".
 */
export function extractFailedTests(html: string, pattern?: string | null): string[] {
  const found: string[] = []
  const add = (raw: string | undefined) => {
    const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (name.length >= 2 && !NOT_A_NAME.test(name) && !found.includes(name)) found.push(name)
  }

  if (pattern?.trim()) {
    const re = new RegExp(pattern, 'gim')
    for (const m of linesOf(html).matchAll(re)) add(m[1] ?? m[0])
    return found.slice(0, MAX_TESTS)
  }

  // 1. Table rows with a failed status (a cell saying FAIL…, or a "fail" class on the row/cell).
  for (const row of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const rowAttrs = row[1] ?? ''
    const cells = [...row[2]!.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((c) => ({ th: c[1]!.toLowerCase() === 'h', attrs: c[2] ?? '', text: textOf(c[3]!) }))
    if (cells.length === 0 || cells.every((c) => c.th)) continue
    const failClass = /class\s*=\s*["'][^"']*\b(fail|failed|failure|error)\b/i
    const failed = failClass.test(rowAttrs) || cells.some((c) => FAIL_WORD.test(c.text) || (failClass.test(c.attrs) && !c.text))
    if (!failed) continue
    add(cells.find((c) => !NOT_A_NAME.test(c.text) && !NUMERIC.test(c.text) && c.text.length >= 2)?.text)
  }
  if (found.length) return found.slice(0, MAX_TESTS)

  // 2. Elements whose class says failed (lists, cards…): their first line of text.
  for (const el of html.matchAll(/<(li|div|span|p|section|article)\b[^>]*class\s*=\s*["'][^"']*\b(fail|failed|failure|error)\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
    add(linesOf(el[3]!).split('\n')[0])
  }
  if (found.length) return found.slice(0, MAX_TESTS)

  // 3. Lines like "FAILED: name", "name ... FAILED", "✗ name".
  for (const line of linesOf(html).split('\n')) {
    const m =
      /^(?:FAIL(?:ED|URE)?|ERROR)\s*[:\-–]\s*(.+)$/i.exec(line) ??
      /^(.+?)\s*(?:\.{2,}|:|-|–|\t)\s*(?:FAIL(?:ED|URE)?|ERROR)\b.*$/i.exec(line) ??
      /^[✗✘❌]\s*(.+)$/.exec(line)
    if (m) add(m[1])
  }
  return found.slice(0, MAX_TESTS)
}

/**
 * How many failures the report says it has ("Failed: 0", "3 failed",
 * "Failures 2"…): the largest count it states, or null when it states none.
 */
export function statedFailures(html: string): number | null {
  const text = linesOf(html)
  const word = String.raw`\b(?:failed|failures?|failing)\b`
  const counts = [
    // "Failed: 0", "Failures (2)"
    ...text.matchAll(new RegExp(String.raw`${word}[ \t]*(?:[:=(]|\bcount\b)?[ \t]*(\d+)(?![\d.%])`, 'gi')),
    // "3 failed", "0Failed" (a count beside its label)
    ...text.matchAll(new RegExp(String.raw`(?<![\w.])(\d+)[ \t]*(?:failed|failures?|failing)\b`, 'gi')),
    // A label with its count alone on the next line (a one-column table).
    ...text.matchAll(new RegExp(String.raw`${word}[ \t]*:?[ \t]*\n[ \t]*(\d+)[ \t]*(?=\n|$)`, 'gi')),
  ].map((m) => Number(m[1]))
  return counts.length ? Math.max(...counts) : null
}

/**
 * Jira keys written in a test name: ABC-123, and the underscore form test
 * names use (test_login_ABC_123). The project's own key in any case; other
 * keys only in upper case.
 */
export function keysInTestName(name: string, projectKey: string | null): string[] {
  const keys = new Set<string>()
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,19})[-_](\d{1,9})(?![0-9])/g)) {
    const prefix = m[1]!
    const own = projectKey !== null && prefix.toUpperCase() === projectKey
    if (!own && (prefix !== prefix.toUpperCase() || /^(TEST|TC|CASE|STEP|RUN|ID|V|HTTP|UTF|SHA)$/.test(prefix))) continue
    keys.add(`${prefix.toUpperCase()}-${Number(m[2])}`)
  }
  return [...keys]
}

/** A failed test: its name as shown, and what identifies its script in Jira. */
export interface FailedTestRef {
  name: string
  /** The test script (Gauge: the spec file; "TC_12345" for specs/TC_12345/case.spec). */
  script?: string
  /** Searched in Jira as written: the script, and tags that look like test IDs. None: searched by the name. */
  ids: string[]
}

/** Tests known by their names only (no script / ID). */
export const byName = (names: string[]): FailedTestRef[] => names.map((name) => ({ name, ids: [] }))

const GENERIC_FILE = /^(case|index|spec|specs|test|tests|main|script|default)$/i

/** The script's name or ID from its path: "specs/TC_12345/case.spec" → "TC_12345", "specs/login_flow.html" → "login_flow". */
export function scriptId(path: string): string {
  const parts = path.split(/[\\/]/).map((p) => p.trim()).filter(Boolean)
  const file = (parts.at(-1) ?? '').replace(/\.(spec|md|cpt|html?)$/i, '')
  return GENERIC_FILE.test(file) && parts.length > 1 ? parts.at(-2)! : file
}

/** Tags that look like test IDs ("TC-123", "testid_456"), not "smoke" or "regression". */
export const idTags = (tags: string[]) => tags.map((t) => t.trim().replace(/^@/, '')).filter((t) => /\d/.test(t) && t.length >= 3 && t.length <= 80)

/** Lowercase words only: "com.acme.Login_Test#ssoTimeout()" → "com acme login test ssotimeout". */
export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** What to search Jira for: the method/last part of a qualified name when it's specific enough. */
export function searchPhrase(name: string): string {
  const parts = name.split(/[.#/:\\]|::/).map((p) => p.trim()).filter(Boolean)
  const last = parts.at(-1) ?? name
  return normalizeName(parts.length > 1 && normalizeName(last).length >= 6 ? last : name)
}

/** Build-page links that are Jenkins' own pages, not reports. */
const JENKINS_PAGES = new Set([
  'console', 'consoleFull', 'consoleText', 'changes', 'testReport', 'artifact', 'parameters', 'api', 'ws', 'configure',
  'timings', 'injectedEnvVars', 'flowGraphTable', 'pipeline-graph', 'pipeline-console', 'replay', 'restart', 'confirmDelete',
  'rebuild', 'badge', 'execution', 'downstreambuildview', 'previousBuild', 'nextBuild', 'buildTimeTrend', 'cause',
])

/**
 * Report pages linked from a Jenkins build page (e.g. the HTML Publisher's
 * "HIT Report"): links under the build whose text says report / HIT / load
 * test, best first. Absolute URLs.
 */
export function reportLinksFromBuildPage(html: string, buildUrl: string): string[] {
  const base = new URL(buildUrl)
  const buildPath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  const scored: { url: string; score: number }[] = []
  for (const a of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL
    try {
      url = new URL(decodeEntities(a[1]!), base)
    } catch {
      continue
    }
    if (url.host !== base.host || !url.pathname.startsWith(buildPath)) continue
    const first = url.pathname.slice(buildPath.length).split('/')[0]
    if (!first || JENKINS_PAGES.has(first) || /^\d+$/.test(first)) continue
    const text = textOf(a[2]!)
    const score = (/report/i.test(text) ? 2 : 0) + (/hit|load|longevity|test|result/i.test(`${text} ${first}`) ? 1 : 0)
    if (score === 0) continue
    url.hash = ''
    if (!scored.some((s) => s.url === url.toString())) scored.push({ url: url.toString(), score })
  }
  return scored.sort((x, y) => y.score - x.score).map((s) => s.url)
}

/**
 * HTML Publisher wraps the report in a page with a frame and one tab per
 * report file (plus a "Zip" download). The report's address: the frame's
 * src when set, else the first tab's file (its value attribute), a link
 * aimed at the frame, or an .html name in the page's inline script.
 */
export function framedReport(html: string, pageUrl: string): string | null {
  const resolve = (href: string) => {
    try {
      return new URL(decodeEntities(href), pageUrl).toString()
    } catch {
      return null
    }
  }
  const usable = (href: string | undefined) => !!href && !/^(about:|javascript:|#)/i.test(href) && !href.includes('*zip*')
  const frame = /<i?frame\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/i.exec(html)?.[1]
  if (usable(frame)) return resolve(frame!)
  if (!/<i?frame\b/i.test(html)) return null
  // The frame is filled by a tab: HTML Publisher keeps each tab's file in its value attribute.
  const tab = /<(?:li|option|span|div|button)\b[^>]*\bvalue\s*=\s*["']([^"']+\.html?(?:[?#][^"']*)?)["']/i.exec(html)?.[1]
  if (usable(tab)) return resolve(tab!)
  const aimed = /<a\b(?=[^>]*\btarget\s*=)[^>]*\bhref\s*=\s*["']([^"']+\.html?(?:[?#][^"']*)?)["']/i.exec(html)?.[1]
  if (usable(aimed)) return resolve(aimed!)
  for (const m of html.matchAll(/["']([^"'\s<>]+\.html?)["']/gi)) if (usable(m[1])) return resolve(m[1]!)
  return null
}
