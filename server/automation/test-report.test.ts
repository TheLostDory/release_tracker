import { describe, expect, it } from 'vitest'
import { extractFailedTests, framedReport, keysInTestName, reportLinksFromBuildPage, searchPhrase } from './test-report.js'

describe('extractFailedTests', () => {
  it('reads failed rows of a results table, skipping passed rows and headers', () => {
    const html = `<table>
      <tr><th>Test</th><th>Status</th><th>Duration</th></tr>
      <tr><td>HIT-Login &amp; SSO</td><td class="pass">PASS</td><td>1.2s</td></tr>
      <tr><td>HIT-Checkout timeout</td><td><span class="label">FAILED</span></td><td>30 s</td></tr>
      <tr class="error"><td>12</td><td>HIT-Export &lt;CSV&gt;</td><td></td></tr>
      <tr><td>HIT-Checkout timeout</td><td>FAIL</td><td>2s</td></tr>
    </table>`
    expect(extractFailedTests(html)).toEqual(['HIT-Checkout timeout', 'HIT-Export <CSV>'])
  })

  it('falls back to elements with a failed class, then to "FAILED:" lines', () => {
    expect(extractFailedTests('<ul><li class="test passed">a ok</li><li class="test failed">search_ABC_42<br>stack…</li></ul>')).toEqual(['search_ABC_42'])
    expect(extractFailedTests('<pre>PASSED: login\nFAILED: checkout_flow\nexport ..... FAILED (3 errors)\n✗ payment refund</pre>')).toEqual([
      'checkout_flow',
      'export',
      'payment refund',
    ])
  })

  it('uses the project pattern when given (first group = name)', () => {
    const html = '<div>Case #12 [KO] login sso</div><div>Case #13 [OK] search</div><div>Case #14 [KO] export</div>'
    expect(extractFailedTests(html, String.raw`\[KO\]\s+(.+)`)).toEqual(['login sso', 'export'])
  })

  it('finds nothing in a clean report', () => {
    expect(extractFailedTests('<table><tr><td>login</td><td>PASS</td></tr></table><p>All 12 tests passed</p>')).toEqual([])
  })
})

describe('test names', () => {
  it('reads Jira keys, including the underscore form', () => {
    expect(keysInTestName('test_login_ABC_123', 'ABC')).toEqual(['ABC-123'])
    expect(keysInTestName('checkout fb-77 regression FB-8', 'ABC')).toEqual(['FB-8'])
    expect(keysInTestName('test_case_12 step_3', 'ABC')).toEqual([])
  })

  it('searches the method of a qualified name, the whole name otherwise', () => {
    expect(searchPhrase('com.acme.checkout.CheckoutTest.paymentTimeout')).toBe('paymenttimeout')
    expect(searchPhrase('HIT-Checkout timeout')).toBe('hit checkout timeout')
    expect(searchPhrase('a.b.ok')).toBe('a b ok')
  })
})

describe('finding the report on the build page', () => {
  const build = 'https://ci.example.com/jenkins/job/qa/job/hit/42/'
  const page = `<div id="tasks">
    <a href="/jenkins/job/qa/job/hit/42/console">Console Output</a>
    <a href="/jenkins/job/qa/job/hit/42/changes">Changes</a>
    <a href="/jenkins/job/qa/job/hit/42/HIT_20Report/">HIT Report</a>
    <a href="/jenkins/job/qa/job/hit/42/artifact/">Build Artifacts</a>
    <a href="/jenkins/job/qa/job/hit/42/Coverage/">Coverage</a>
    <a href="/jenkins/job/qa/job/hit/41/">Previous build</a>
    <a href="https://elsewhere.example.com/report/">External report</a>
  </div>`

  it('finds report links under the build (not Jenkins pages, other builds or other hosts)', () => {
    expect(reportLinksFromBuildPage(page, build)).toEqual(['https://ci.example.com/jenkins/job/qa/job/hit/42/HIT_20Report/'])
  })

  it('follows the frame HTML Publisher wraps reports in', () => {
    expect(framedReport('<html><body><iframe id="myframe" src="index.html"></iframe></body></html>', 'https://ci/job/x/1/HIT_20Report/')).toBe(
      'https://ci/job/x/1/HIT_20Report/index.html',
    )
    expect(framedReport('<html><body>No frame</body></html>', 'https://ci/x/')).toBeNull()
  })
})
