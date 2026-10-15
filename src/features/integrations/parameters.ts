/** "KEY=value" lines → { KEY: value }; returns an error for bad lines. */
export function parseParameters(text: string): { params: Record<string, string>; error: string | null } {
  const params: Record<string, string> = {}
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    const key = eq === -1 ? '' : line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key)) return { params, error: `Line ${n + 1}: use KEY=value` }
    params[key] = line.slice(eq + 1).trim()
  }
  return { params, error: null }
}
