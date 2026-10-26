import { describe, expect, it } from 'vitest'
import { failedFromGaugeResult, failedScenariosOnSpecPage, failedSpecLinks, isGaugeReport } from './gauge.js'

describe('Gauge reports', () => {
  it('reads failed scenarios from result.js / result.json', () => {
    const js = `var gaugeExecutionResult = ${JSON.stringify({
      suiteResult: {
        specResults: [
          { specHeading: 'Checkout', scenarios: [{ scenarioHeading: 'Pay by card', executionStatus: 'pass' }, { scenarioHeading: 'Pay timeout', executionStatus: 'fail' }] },
          { specHeading: 'Search', scenarios: [{ scenarioHeading: 'Filters reset', failed: true }] },
        ],
      },
    })};`
    expect(failedFromGaugeResult(js)).toEqual(['Checkout: Pay timeout', 'Search: Filters reset'])
    expect(failedFromGaugeResult(JSON.stringify({ specResults: [{ specHeading: 'A', scenarios: [{ scenarioHeading: 'b', executionStatus: 'failed' }] }] }))).toEqual(['A: b'])
    expect(failedFromGaugeResult('<html>not json</html>')).toBeNull()
  })

  it('finds the failed specs on the overview page', () => {
    const index = `<html><head><title>Gauge Report</title></head><body><ul id="listOfSpecifications">
      <li class="spec-name passed"><a href="specs/login.html">Login</a></li>
      <li class="spec-name failed"><a href="specs/checkout.html#top">Checkout</a></li>
      <li class='spec-name failed'><a href='specs/search.html'>Search</a></li>
    </ul></body></html>`
    expect(isGaugeReport(index)).toBe(true)
    expect(failedSpecLinks(index, 'https://ci/job/x/5/HTML_20Report/index.html')).toEqual([
      'https://ci/job/x/5/HTML_20Report/specs/checkout.html',
      'https://ci/job/x/5/HTML_20Report/specs/search.html',
    ])
  })

  it('reads the failed scenarios of a spec page, with the spec heading', () => {
    const spec = `<h1 class="spec-heading">Checkout</h1>
      <div class="scenario-container passed"><h3 class="head">Pay by card</h3></div>
      <div class="scenario-container failed"><div class="scenario-head"><h3 class="head">Pay &amp; timeout</h3></div><pre>stack</pre></div>`
    expect(failedScenariosOnSpecPage(spec)).toEqual(['Checkout: Pay & timeout'])
  })
})
