import { describe, expect, it } from 'vitest'
import { failedFromGaugeResult, failedSpecs, failedFromScript, failedScenariosOnSpecPage, failedSpecLinks, inlineScripts, isGaugeReport, scriptSources, specCounts } from './gauge.js'

const names = (refs: { name: string }[] | null) => refs?.map((t) => t.name) ?? null

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
    expect(names(failedFromGaugeResult(js))).toEqual(['Checkout: Pay timeout', 'Search: Filters reset'])
    expect(names(failedFromGaugeResult(JSON.stringify({ specResults: [{ specHeading: 'A', scenarios: [{ scenarioHeading: 'b', executionStatus: 'failed' }] }] })))).toEqual(['A: b'])
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
    expect(names(failedScenariosOnSpecPage(spec))).toEqual(['Checkout: Pay & timeout'])
  })

  it("reads Gauge's own template, where the link wraps the spec item", () => {
    const index = `<div id="listOfSpecifications"><ul id="scenarios" class="spec-list">
      <a href="specs/login.html"><li class='spec-name passed'><span class="scenarioname">Login</span></li></a>
      <a href="specs/checkout.html"><li class='spec-name failed'><span class="scenarioname">Checkout</span></li></a>
      <a href="specs/export.html"><li class='spec-name failed'><span class="scenarioname">Export</span></li></a>
    </ul></div>`
    expect(failedSpecLinks(index, 'https://ci/r/index.html')).toEqual(['https://ci/r/specs/checkout.html', 'https://ci/r/specs/export.html'])
    expect(specCounts(index, 'https://ci/r/index.html')).toEqual({ specs: 3, failed: 2 })
    // Spec pages name scenarios with a span.
    expect(names(failedScenariosOnSpecPage(`<h1>Export</h1><div class="scenario-container failed"><span class="scenarioName">CSV export</span></div>`))).toEqual(['Export: CSV export'])
  })

  it('finds result data in scripts the page loads or embeds', () => {
    const shell = `<html><head><title>Gauge Report</title>
      <script src="js/vendor.js"></script><script src="./data/result.js"></script><script src="https://cdn.example.com/x.js"></script>
      <script>window.boot({ "suiteResult": { "specResults": [ { "specHeading": "Pay", "scenarios": [ { "scenarioHeading": "Card {declined}", "executionStatus": "fail" } ] } ] } });</script>
      </head><body><div id="root"></div></body></html>`
    expect(scriptSources(shell, 'https://ci/job/x/5/HTML_20Report/index.html')).toEqual([
      'https://ci/job/x/5/HTML_20Report/js/vendor.js',
      'https://ci/job/x/5/HTML_20Report/data/result.js',
    ])
    expect(names(failedFromScript(inlineScripts(shell).join('\n')))).toEqual(['Pay: Card {declined}'])
    expect(names(failedFromScript('var gaugeExecutionResult = {"specResults":[{"specHeading":"A","scenarios":[{"scenarioHeading":"b","failed":true}]}]};'))).toEqual(['A: b'])
    expect(failedFromScript('function x(){ return 1 }')).toBeNull()
  })

  it("knows each failed test by its script and ID tags, not the scenario's title", () => {
    const data = JSON.stringify({
      specResults: [
        { specHeading: 'Checkout', fileName: 'C:\\ws\\specs\\TC_12345\\case.spec', tags: ['smoke', '@TC-777'], scenarios: [{ scenarioHeading: 'Pay', failed: true, tags: ['JIRA_9'] }] },
        { specHeading: 'Search flow', scenarios: [{ scenarioHeading: 'Filters', failed: true }] },
      ],
    })
    expect(failedFromGaugeResult(data)).toEqual([
      { name: 'Checkout: Pay', script: 'TC_12345', ids: ['TC_12345', 'TC-777', 'JIRA_9'] },
      { name: 'Search flow: Filters', ids: ['Search flow'] }, // no file: the spec's name
    ])

    const page = `<header><h1>Checkout</h1><div class="spec-filename"><label><span class="fa"></span>specs/login_flow.spec</label></div>
      <div class="tags contentSection"><strong>Tags:</strong><span>regression</span><span>TC_500</span></div></header>
      <div class="scenario-container passed"><h3>Pay by card</h3><div class="tags scenario_tags"><span>TC_501</span></div></div>
      <div class="scenario-container failed"><h3>Pay timeout</h3><div class="tags scenario_tags contentSection"><strong>Tags:</strong> TC_502, slow</div><pre>x</pre></div>`
    expect(failedScenariosOnSpecPage(page)).toEqual([{ name: 'Checkout: Pay timeout', script: 'login_flow', ids: ['login_flow', 'TC_500', 'TC_502'] }])

    // The overview: the folder names the script when every file is case.html.
    expect(failedSpecs('<a href="specs/TC_9/case.html"><li class="spec-name failed">Login</li></a><a href="specs/export_csv.html"><li class="spec-name failed">Export</li></a>', 'https://ci/r/index.html')).toEqual([
      { url: 'https://ci/r/specs/TC_9/case.html', name: 'Login', script: 'TC_9' },
      { url: 'https://ci/r/specs/export_csv.html', name: 'Export', script: 'export_csv' },
    ])
  })
})
