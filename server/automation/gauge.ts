import { decodeEntities, textOf } from './test-report.js'

/**
 * Gauge (gauge.org) HTML reports: an overview page listing the specs, one page
 * per spec with its scenarios, and (in recent versions) the whole result as
 * JSON in js/result.js. Failed tests are named "Spec: Scenario". Pure (tested).
 */

/** Whether a page looks like a Gauge HTML report. */
export const isGaugeReport = (html: string) => /gauge/i.test(html) && /spec|scenario/i.test(html)

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
  const anchors = [...blocks.flatMap((b) => [...b[3]!.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)]), ...indexHtml.matchAll(/<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bfail)[^>]*href\s*=\s*["']([^"']+)["']/gi)]
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
