/**
 * Returns the URL if it is an absolute http(s) URL, otherwise null.
 * Use for every user-entered link before rendering it as an href
 * (the database enforces the same rule via public.is_http_url).
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
