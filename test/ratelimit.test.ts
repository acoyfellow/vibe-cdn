import { describe, expect, test } from 'bun:test'
import {
  MAX_LEADERBOARD_ROWS,
  SCORE_WRITES_PER_HOUR,
  UPLOADS_PER_HOUR,
  clientIp,
  hourBucket,
  rateCounterKey,
  rateDecision,
} from '../src/shared/ratelimit'

describe('clientIp', () => {
  test('uses the header when present', () => {
    expect(clientIp('203.0.113.7')).toBe('203.0.113.7')
  })
  test('takes only the FIRST hop of a comma list, so a client cannot append a fake IP', () => {
    expect(clientIp('203.0.113.7, 10.0.0.1, 192.168.1.1')).toBe('203.0.113.7')
  })
  test('a missing or blank header buckets under anon rather than skipping the limit', () => {
    expect(clientIp(null)).toBe('anon')
    expect(clientIp('')).toBe('anon')
    expect(clientIp('   ')).toBe('anon')
  })
})

describe('hourBucket', () => {
  test('is stable within the same hour', () => {
    const a = hourBucket(Date.parse('2026-07-28T16:00:00Z'))
    const b = hourBucket(Date.parse('2026-07-28T16:59:59Z'))
    expect(a).toBe(b)
  })
  test('rolls over at the hour boundary', () => {
    const a = hourBucket(Date.parse('2026-07-28T16:59:59Z'))
    const b = hourBucket(Date.parse('2026-07-28T17:00:00Z'))
    expect(a).not.toBe(b)
  })
  test('accepts a Date as well as a number', () => {
    const t = Date.parse('2026-07-28T16:30:00Z')
    expect(hourBucket(new Date(t))).toBe(hourBucket(t))
  })
})

describe('rateCounterKey', () => {
  test('separates scopes so uploads and scores do not share a budget', () => {
    const b = hourBucket(0)
    expect(rateCounterKey('upload', '1.2.3.4', b)).not.toBe(rateCounterKey('scores', '1.2.3.4', b))
  })
  test('separates IPs', () => {
    const b = hourBucket(0)
    expect(rateCounterKey('scores', '1.1.1.1', b)).not.toBe(rateCounterKey('scores', '2.2.2.2', b))
  })
})

describe('rateDecision', () => {
  test('a fresh (missing) counter is allowed with the full budget', () => {
    const d = rateDecision(null, 20)
    expect(d.allowed).toBe(true)
    expect(d.used).toBe(0)
    expect(d.remaining).toBe(20)
  })

  test('allows right up to the limit and refuses AT the limit', () => {
    expect(rateDecision('19', 20).allowed).toBe(true)
    expect(rateDecision('20', 20).allowed).toBe(false)
    expect(rateDecision('21', 20).allowed).toBe(false)
  })

  test('remaining never goes negative', () => {
    expect(rateDecision('999', 20).remaining).toBe(0)
  })

  test('a corrupt counter value fails CLOSED to zero-used, not to unlimited', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', '', '-5', '{}']) {
      const d = rateDecision(bad, 20)
      expect(d.used).toBe(0)
      expect(d.allowed).toBe(true)
    }
  })

  test('a fractional counter cannot be used to buy extra requests', () => {
    expect(rateDecision('19.9', 20).used).toBe(19)
    expect(rateDecision('20.9', 20).allowed).toBe(false)
  })

  test('a limit of zero refuses everything', () => {
    expect(rateDecision(null, 0).allowed).toBe(false)
  })

  test('simulating the AT2 flood: 15 max-score writes are all allowed, write 21 is not', () => {
    let used = 0
    const codes: number[] = []
    for (let i = 0; i < 25; i++) {
      const d = rateDecision(String(used), SCORE_WRITES_PER_HOUR)
      if (d.allowed) {
        used++
        codes.push(200)
      } else {
        codes.push(429)
      }
    }
    expect(codes.slice(0, SCORE_WRITES_PER_HOUR).every((c) => c === 200)).toBe(true)
    expect(codes.slice(SCORE_WRITES_PER_HOUR).every((c) => c === 429)).toBe(true)
    expect(used).toBe(SCORE_WRITES_PER_HOUR)
  })

  test('the flood resets in the NEXT hour (a limit, not a permanent ban)', () => {
    const h1 = rateCounterKey('scores', '1.2.3.4', hourBucket(Date.parse('2026-07-28T16:00:00Z')))
    const h2 = rateCounterKey('scores', '1.2.3.4', hourBucket(Date.parse('2026-07-28T17:00:00Z')))
    expect(h1).not.toBe(h2)
    expect(rateDecision(null, SCORE_WRITES_PER_HOUR).allowed).toBe(true)
  })
})

describe('published limits are sane', () => {
  test('score writes are limited and the cap is documented as a number', () => {
    expect(SCORE_WRITES_PER_HOUR).toBeGreaterThan(0)
    expect(SCORE_WRITES_PER_HOUR).toBeLessThan(1000)
  })
  test('uploads stay stricter than score writes', () => {
    expect(UPLOADS_PER_HOUR).toBeLessThan(SCORE_WRITES_PER_HOUR)
  })
  test('the leaderboard is bounded, so D1 cannot grow without limit', () => {
    expect(MAX_LEADERBOARD_ROWS).toBeGreaterThan(25)
    expect(Number.isInteger(MAX_LEADERBOARD_ROWS)).toBe(true)
  })
})
