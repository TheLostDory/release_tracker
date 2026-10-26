/** Helpers for sending a drafted email from the browser (pure, tested). */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Edited plain text → simple HTML (paragraphs, line breaks, links). */
export function textToHtml(text: string): string {
  const linked = (line: string) => esc(line).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
  const paragraphs = text.split(/\n{2,}/).map((p) => `<p>${p.split('\n').map(linked).join('<br>')}</p>`)
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${paragraphs.join('\n')}</div>`
}

/** Mail apps reject long mailto links: past this, the body goes through the clipboard. */
export const MAILTO_BODY_LIMIT = 1800

/** A mailto: link (recipients separated by ; or , as typed). */
export function mailtoUrl(to: string, cc: string, subject: string, body: string | null): string {
  const params = [
    cc.trim() && `cc=${encodeURIComponent(cc.trim())}`,
    `subject=${encodeURIComponent(subject)}`,
    body !== null && `body=${encodeURIComponent(body)}`,
  ].filter(Boolean)
  return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}?${params.join('&')}`
}
