function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local.`)
  }
  return value
}

/**
 * VITE_SUPABASE_URL=same-origin means the API is served by the same host as
 * the app (the Docker stack's gateway routes /auth, /rest, /realtime), so the
 * image works on any host/port without rebuilding.
 */
function resolveSupabaseUrl(value: string): string {
  return value === 'same-origin' ? window.location.origin : value
}

export const env = {
  supabaseUrl: resolveSupabaseUrl(required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)),
  supabaseKey: required('VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
} as const
