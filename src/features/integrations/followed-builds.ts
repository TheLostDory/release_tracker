import type { BuildNode } from './api'

export interface DownstreamSummary {
  total: number
  passed: number
  /** Finished with warnings (e.g. some tests flagged); not a failure. */
  unstable: number
  failed: number
  running: number
  queued: number
}

/** Counts every build below `node` (not the node itself). */
export function summarizeDownstream(node: BuildNode): DownstreamSummary {
  const s: DownstreamSummary = { total: 0, passed: 0, unstable: 0, failed: 0, running: 0, queued: 0 }
  const walk = (n: BuildNode) => {
    for (const ch of n.children) {
      s.total++
      if (ch.queued) s.queued++
      else if (ch.building) s.running++
      else if (ch.result === 'SUCCESS') s.passed++
      else if (ch.result === 'UNSTABLE') s.unstable++
      else if (ch.result === 'FAILURE' || ch.result === 'ABORTED') s.failed++
      walk(ch)
    }
  }
  walk(node)
  return s
}

export function summaryText(s: DownstreamSummary): string {
  if (s.total === 0) return ''
  const parts = [
    s.passed && `${s.passed} passed`,
    s.unstable && `${s.unstable} unstable`,
    s.failed && `${s.failed} failed`,
    s.running && `${s.running} running`,
    s.queued && `${s.queued} queued`,
  ].filter(Boolean)
  return `${s.total} downstream build${s.total === 1 ? '' : 's'}${parts.length ? `: ${parts.join(' · ')}` : ''}`
}

/** Running build's progress from Jenkins' estimate (0–99 %), or null when unknown. */
export function buildProgress(node: BuildNode, now: number): number | null {
  if (!node.building || node.timestamp == null || !node.estimatedDuration) return null
  return Math.max(0, Math.min(99, Math.round(((now - node.timestamp) / node.estimatedDuration) * 100)))
}

/** 61000 → "1m 1s". */
export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/**
 * Time left for a running build from Jenkins' estimate: "~12 min left", or
 * "running 4 min longer than usual" once past it. Null when not running or
 * no estimate.
 */
export function timeLeftText(node: BuildNode, now: number): string | null {
  if (!node.building || node.timestamp == null || !node.estimatedDuration) return null
  const left = node.estimatedDuration - (now - node.timestamp)
  if (left >= 0) return `~${formatMinutes(left)} left`
  return `running ${formatMinutes(-left)} longer than usual`
}

/** 45 s → "1 min", 3 900 000 → "1 h 5 min". */
export function formatMinutes(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
