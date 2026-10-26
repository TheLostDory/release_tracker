import { decodeEntities, textOf } from './test-report.js'

/**
 * Gauge (gauge.org) HTML reports: an overview page listing the specs, one page
 * per spec with its scenarios, and (in recent versions) the whole result as
 * JSON in js/result.js. Failed tests are named "Spec: Scenario". Pure (tested).
 */

/** Whether a page looks like a Gauge HTML report. */
export const isGaugeReport = (html: string) => /gauge/i.test(html)

const name = (spec: string, scenario: string) => (spec ? `${spec.trim()}: ${scenario.trim()}` : scenario.trim())

interface GaugeScenario {
  scenarioHeading?: string
  executionStatus?: string
  failed?: boolean
}
interface GaugeSpec {
  specHeading?: string
  scenarios?: GaugeScenario[]
}

/**
 * Failed scenarios from Gauge's result data: js/result.js
 * ("var gaugeExecutionResult = {…}") or json-report's result.json. Null when
 * the text isn't that.
 */
export function failedFromGaugeResult(text: string): string[] | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let data: { suiteResult?: { specResults?: GaugeSpec[] }; specResults?: GaugeSpec[] }
  try {
    data = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  const specs = data.suiteResult?.specResults ?? data.specResults
  if (!Array.isArray(specs)) return null
  const out: string[] = []
  for (const spec of specs) {
    for (const sc of spec.scenarios ?? []) {
      const failed = sc.failed === true || /^fail/i.test(sc.executionStatus ?? '')
      if (failed && sc.scenarioHeading) out.push(name(spec.specHeading ?? '', sc.scenarioHeading))
    }
  }
  return out
}

const failedClass = /class\s*=\s*["'][^"']*\b(failed|fail|failure)\b[^"']*["']/i

/** Links to the spec pages marked failed on the overview page (absolute URLs). */
export function failedSpecLinks(indexHtml: string, indexUrl: string): string[] {
  const links: string[] = []
  // A failed list item / row / card with a link in it, or a failed link itself.
  const blocks = [
    ...indexHtml.matchAll(/<(li|tr|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi),
  ].filter((b) => failedClass.test(b[2] ?? ''))
  // Gauge's own template wraps each spec item in its link: <a href="…"><li class="spec-name failed">…</li></a>.
  const wrapping = [...indexHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].filter((a) => failedClass.test(a[2] ?? ''))
  const anchors = [
    ...blocks.flatMap((b) => [...b[3]!.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)]),
    ...wrapping,
    ...indexHtml.matchAll(/<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bfail)[^>]*href\s*=\s*["']([^"']+)["']/gi),
  ]
  for (const a of anchors) {
    try {
      const url = new URL(decodeEntities(a[1]!), indexUrl)
      url.hash = ''
      if (/\.html?$/i.test(url.pathname) && !links.includes(url.toString())) links.push(url.toString())
    } catch {
      // not a link
    }
  }
  return links
}

/** Failed scenarios on a Gauge spec page, named with the spec heading. */
export function failedScenariosOnSpecPage(specHtml: string): string[] {
  const specHeading = textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(specHtml)?.[1] ?? '') || textOf(/class\s*=\s*["'][^"']*spec-?(heading|name)[^"']*["'][^>]*>([\s\S]*?)</i.exec(specHtml)?.[2] ?? '')
  const out: string[] = []
  // Scenario blocks marked failed: their first heading (or an element named like a scenario heading).
  for (const m of specHtml.matchAll(/<(div|section|li|article)\b([^>]*)>/gi)) {
    const attrs = m[2] ?? ''
    if (!/scenario/i.test(attrs) || !failedClass.test(attrs)) continue
    const after = specHtml.slice(m.index! + m[0].length, m.index! + m[0].length + 4000)
    const heading =
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(after)?.[1] ??
      /<[a-z]+\b[^>]*class\s*=\s*["'][^"']*scenario-?(?:name|head|heading|title)[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/i.exec(after)?.[1]
    const text = textOf(heading ?? '')
    if (text && !out.includes(name(specHeading, text))) out.push(name(specHeading, text))
  }
  return out
}

/** What the overview page shows: spec links in all, and how many are marked failed (for the settings "Test" tool). */
export function specCounts(indexHtml: string, indexUrl: string): { specs: number; failed: number } {
  const all = new Set<string>()
  for (const a of indexHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+\.html?)[^"']*["']/gi)) {
    try {
      all.add(new URL(decodeEntities(a[1]!), indexUrl).toString())
    } catch {
      // not a link
    }
  }
  return { specs: all.size, failed: failedSpecLinks(indexHtml, indexUrl).length }
}

/** Script files a page loads from the page's own host (not CDNs), absolute, in page order. */
export function scriptSources(html: string, pageUrl: string): string[] {
  const host = new URL(pageUrl).host
  const out: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(m[1]!), pageUrl)
      if (url.host === host && !out.includes(url.toString())) out.push(url.toString())
    } catch {
      // not a link
    }
  }
  return out
}

/** Inline <script> blocks of a page (where some reports embed their data). */
export const inlineScripts = (html: string) => [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!).filter((t) => t.trim())

/**
 * Gauge result data anywhere in a script: the object holding "specResults"
 * (assigned to a variable, passed to a function, or plain JSON). Null if none.
 */
export function failedFromScript(text: string): string[] | null {
  const at = text.search(/["']?specResults["']?\s*:/)
  if (at === -1) return null
  // Walk back to each "{" before it and try the balanced object from there (outermost first).
  for (let start = text.lastIndexOf('{', at); start !== -1; start = text.lastIndexOf('{', start - 1)) {
    const end = matchingBrace(text, start)
    if (end === -1) continue
    const found = failedFromGaugeResult(text.slice(start, end + 1))
    if (found) {
      // Prefer the object that also has suiteResult around it, if any.
      const outer = text.lastIndexOf('{', start - 1)
      if (outer !== -1 && matchingBrace(text, outer) !== -1) {
        const wider = failedFromGaugeResult(text.slice(outer, matchingBrace(text, outer) + 1))
        if (wider && wider.length >= found.length) return wider
      }
      return found
    }
  }
  return null
}

/** Index of the "}" closing the "{" at `start` (strings respected), or -1. */
function matchingBrace(text: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < text.length && i < start + 20_000_000; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/** Failed specs with their names as the overview shows them (falls back to the file's folder). */
export function failedSpecs(indexHtml: string, indexUrl: string): { url: string; name: string }[] {
  const names = new Map<string, string>()
  for (const a of indexHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeEntities(a[1]!), indexUrl)
      url.hash = ''
      const text = textOf(a[2]!).replace(/\s+\d+(\.\d+)?\s*(ms|s|sec|m|min)?\s*$/i, '').trim()
      if (text && !names.has(url.toString())) names.set(url.toString(), text)
    } catch {
      // not a link
    }
  }
  return failedSpecLinks(indexHtml, indexUrl).map((url) => {
    const parts = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean)
    const file = parts.at(-1)!.replace(/\.html?$/i, '')
    // "case.html" everywhere: the folder says more than the file.
    const fallback = (/^(case|index|spec|test)$/i.test(file) && parts.length > 1 ? parts.at(-2)! : file).replace(/[_-]+/g, ' ')
    return { url, name: names.get(url) || fallback }
  })
}
