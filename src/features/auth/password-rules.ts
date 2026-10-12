/** Mirrors the auth server's rules (min length 10, letters and digits). */
export const PASSWORD_MIN_LENGTH = 10

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers.'
  return null
}

/** Friendlier wording for common auth errors. */
export function authErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const message = error instanceof Error ? error.message : ''
  if (/already registered|already been registered|user_already_exists/i.test(message)) {
    return 'An account with this email already exists. Sign in instead.'
  }
  if (/signups? not allowed|signup_disabled/i.test(message)) return 'Sign-up is turned off. Ask an admin for an account.'
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: check your inbox for the link.'
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.'
  if (/weak|password should/i.test(message)) return message
  return message || fallback
}
