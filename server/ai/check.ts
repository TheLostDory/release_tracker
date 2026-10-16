/**
 * Checks the AI assistant settings by asking the gateway one tiny question.
 *   docker compose exec app node dist-server/server/ai/check.js
 * If the gateway uses a company certificate this server doesn't trust, it
 * prints the AI_CA_CERT line to add to ai.env (after you check the details).
 */
import { loadConfig } from '../config.js'
import { inspectCertificates } from '../integrations/certificate.js'
import { aiSettings, askModel } from './client.js'

const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused', ...process.env })
try {
  const s = aiSettings(config)
  console.log(`Format:  ${s.format}\nURL:     ${s.url}\nHeaders: ${Object.keys(s.headers).join(', ') || '(none)'}\nCA cert: ${s.ca ? 'set' : 'not set'}\n`)
  const answer = await askModel(config, 'You are a connectivity check.', [{ role: 'user', content: 'Reply with the single word OK.' }])
  console.log(`✔ The AI service answered: ${answer.slice(0, 200)}`)
} catch (err) {
  const message = (err as Error).message
  console.error(`✘ ${message}`)
  if (/certificate/i.test(message) && config.AI_BASE_URL?.startsWith('https:')) {
    try {
      const { host, certificates, recommended } = await inspectCertificates(config.AI_BASE_URL)
      const root = certificates[recommended]!
      console.error(`\n${host} presents a certificate issued by: ${root.subject}`)
      console.error(`  expires ${root.validTo.slice(0, 10)} · SHA-256 ${root.fingerprint256}`)
      console.error('If that is your company, add this line to ai.env, then run: docker compose up -d\n')
      console.error(`AI_CA_CERT=${root.pem.trim().replaceAll('\n', '\\n')}`)
    } catch (inspectErr) {
      console.error(`(Couldn't read the certificate: ${(inspectErr as Error).message})`)
    }
  }
  process.exitCode = 1
}
