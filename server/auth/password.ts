import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * scrypt with OWASP-recommended cost (N=2^16, r=8, p=2). Stored format:
 *   scrypt$<log2N>$<r>$<p>$<salt b64>$<hash b64>
 * so the cost can be raised later without breaking existing hashes.
 */
const LOG2_N = 16
const R = 8
const P = 2
const KEY_LEN = 64

function scrypt(password: string, salt: Buffer, keyLen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

const options = (log2n: number, r: number, p: number): ScryptOptions => ({
  N: 2 ** log2n,
  r,
  p,
  maxmem: 2 * 128 * 2 ** log2n * r * p + 1024 * 1024,
})

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LEN, options(LOG2_N, R, P))
  return `scrypt$${LOG2_N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, log2n, r, p, salt, hash] = stored.split('$')
  if (algo !== 'scrypt' || !log2n || !r || !p || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, options(+log2n, +r, +p))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Same rule as the UI: 10+ characters with letters and digits. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.'
  if (password.length > 200) return 'Use at most 200 characters.'
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers.'
  return null
}
