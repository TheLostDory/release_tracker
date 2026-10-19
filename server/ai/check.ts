/**
 * Checks the AI assistant settings by asking the gateway one tiny question.
 *   docker compose exec app node dist-server/server/ai/check.js
 * If the gateway (or its login URL) uses a company certificate this server
 * doesn't trust, it prints the AI_CA_CERT line to add to ai.env (after you
 * check the details).
 */
import { loadConfig } from '../config.js'
import { inspectCertificates } from '../integrations/certificate.js'
import { aiSettings, askModel, TOKEN_SERVICE } from './client.js'
import { probeGateway } from './probe.js'
import { tryVariants } from './variants.js'

// Try other models without editing ai.env:  check.js --model gemini-2.5-flash,gemini-3.7-flash
const modelArg = process.argv.indexOf('--model')
const models = modelArg > 0 ? (process.argv[modelArg + 1] ?? '').split(',').map((m) => m.trim()).filter(Boolean) : []
if (models.length > 1) {
  const { execFileSync } = await import('node:child_process')
  for (const m of models) {
    console.log(`\n=== ${m} ===`)
    try {
      execFileSync(process.execPath, [process.argv[1]!, '--model', m], { stdio: 'inherit' })
    } catch {
      // the child already printed why
    }
  }
  process.exit(0)
}
const config = loadConfig({ DATABASE_URL: 'postgres://unused@localhost/unused', ...process.env, ...(models[0] ? { AI_MODEL: models[0] } : {}) })
try {
  const s = aiSettings(config)
  console.log(
    [
      `Model:     ${s.model}`,
      `Agent:     ${config.AI_USER_AGENT ?? '(default)'}`,
      `Format:    ${s.format}`,
      `URL:       ${s.url}`,
      `Headers:   ${s.headerNames.join(', ') || '(none)'}`,
      `Login:     ${s.usesToken ? `${config.AI_TOKEN_URL} (client ${config.AI_CLIENT_ID}, ${config.AI_TOKEN_AUTH})` : 'none (static headers)'}`,
      `CA cert:   ${s.ca ? 'set' : 'not set'}`,
      '',
    ].join('\n'),
  )
  const answer = await askModel(config, 'You are a connectivity check.', [{ role: 'user', content: 'Reply with the single word OK.' }])
  console.log(`✔ The AI service answered: ${answer.slice(0, 200)}`)
} catch (err) {
  const message = (err as Error).message
  console.error(`✘ ${message}`)
  const failedUrl = message.startsWith(TOKEN_SERVICE) ? config.AI_TOKEN_URL : config.AI_BASE_URL
  if (/certificate/i.test(message) && failedUrl?.startsWith('https:')) {
    try {
      const { host, certificates, recommended } = await inspectCertificates(failedUrl)
      const root = certificates[recommended]!
      console.error(`\n${host} presents a certificate issued by: ${root.subject}`)
      console.error(`  expires ${root.validTo.slice(0, 10)} · SHA-256 ${root.fingerprint256}`)
      console.error('If that is your company, add this line to ai.env, then run: docker compose up -d')
      console.error('(If AI_CA_CERT is already set for another host, append this certificate after it, separated by \\n.)\n')
      console.error(`AI_CA_CERT=${root.pem.trim().replaceAll('\n', '\\n')}`)
    } catch (inspectErr) {
      console.error(`(Couldn't read the certificate: ${(inspectErr as Error).message})`)
    }
  }
  // Server error for a request another client gets through: find which difference matters.
  if (/returned HTTP 5\d\d/.test(message) && !message.startsWith(TOKEN_SERVICE)) {
    console.error('\nTrying the request the ways the AI Relay extension differs (one tiny request each)…\n')
    try {
      const results = await tryVariants(config)
      for (const r of results) console.error(`  ${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : `: ${r.message}`}`)
      const hit = results.find((r) => r.ok)
      if (hit) {
        console.error(`\nThat one works. Add to ai.env, then: docker compose up -d\n  ${hit.fix}`)
      } else {
        console.error(
          '\nNone of them helped: compare the model with the extension (/model in its chat), or ask the gateway team what changed (time of the error, model, "ErrorResponseCode").',
        )
      }
    } catch (variantErr) {
      console.error(`(Couldn't try the variants: ${(variantErr as Error).message})`)
    }
  }
  // Wrong path: try the usual layouts under AI_BASE_URL to find the right one.
  if (/HTTP 404|HTTP 405/.test(message) && !message.startsWith(TOKEN_SERVICE)) {
    console.error('\nTrying the usual paths under AI_BASE_URL (one tiny request each)…\n')
    try {
      const results = await probeGateway(config)
      for (const r of results) console.error(`  ${String(r.status).padEnd(5)} ${r.format.padEnd(6)} ${r.path || '(AI_BASE_URL itself)'}  ${r.status === 404 ? '' : r.message}`)
      const hit = results.find((r) => r.status === 200) ?? results.find((r) => typeof r.status === 'number' && r.status !== 404 && r.status !== 405)
      if (hit) {
        const format = hit.format === 'openai' ? 'openai' : config.AI_FORMAT === 'openai' ? 'gemini' : config.AI_FORMAT
        console.error(`\n${hit.status === 200 ? 'This one works' : 'This path exists (it answered, but not with 200)'}. Add to ai.env, then: docker compose up -d`)
        console.error(`  AI_PATH=${hit.path || '/'}`)
        if (format !== config.AI_FORMAT) console.error(`  AI_FORMAT=${format}`)
      } else {
        console.error('\nNone of the usual paths exist. Ask the gateway team for the full request URL (or an example curl).')
      }
    } catch (probeErr) {
      console.error(`(Couldn't try other paths: ${(probeErr as Error).message})`)
    }
  }
  process.exitCode = 1
}
