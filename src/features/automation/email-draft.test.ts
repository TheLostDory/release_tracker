import { describe, expect, it } from 'vitest'
import { mailtoUrl, textToHtml } from './email-draft'

describe('email draft helpers', () => {
  it('turns edited text into HTML with links, escaping the rest', () => {
    expect(textToHtml('Hi <team>,\n\nSee https://x.test/r/1\nThanks')).toContain(
      '<p>Hi &lt;team&gt;,</p>\n<p>See <a href="https://x.test/r/1">https://x.test/r/1</a><br>Thanks</p>',
    )
  })

  it('builds mailto links, leaving out an empty cc and a body that is too long', () => {
    expect(mailtoUrl('qa@example.com', '', 'RC 7 is ready', 'Hi all')).toBe('mailto:qa@example.com?subject=RC%207%20is%20ready&body=Hi%20all')
    expect(mailtoUrl('a@x.com; b@x.com', 'pm@x.com', 'S', null)).toBe('mailto:a@x.com%3B%20b@x.com?cc=pm%40x.com&subject=S')
  })
})
