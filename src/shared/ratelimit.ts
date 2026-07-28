export const UPLOADS_PER_HOUR = 5
export const SCORE_WRITES_PER_HOUR = 20
export const MAX_LEADERBOARD_ROWS = 1000

export type RateDecision = {
  allowed: boolean
  used: number
  remaining: number
  limit: number
}

export function hourBucket(now: Date | number): string {
  const d = typeof now === 'number' ? new Date(now) : now
  return d.toISOString().slice(0, 13)
}

export function rateCounterKey(scope: string, ip: string, bucket: string): string {
  return `rate:${scope}:${ip}:${bucket}`
}

export function clientIp(headerValue: string | null): string {
  const raw = (headerValue ?? '').split(',')[0]?.trim() ?? ''
  return raw === '' ? 'anon' : raw
}

export function rateDecision(rawCounterValue: string | null, limit: number): RateDecision {
  const parsed = Number(rawCounterValue ?? '0')
  const used = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  return {
    allowed: used < limit,
    used,
    remaining: Math.max(0, limit - used),
    limit,
  }
}
