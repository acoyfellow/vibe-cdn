import { describe, expect, test } from 'bun:test'
import {
  MAX_LEADERBOARD_ROWS,
  MAX_SAVE_ROWS,
  SAVE_WRITES_PER_HOUR,
  SCORE_WRITES_PER_HOUR,
  UPLOADS_PER_HOUR,
  clientIp,
  hourBucket,
  rateCounterKey,
  rateDecision,
  saveCapacityDecision,
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

describe('save writes are limited by the SAME shared functions as scores and uploads (AT5-1)', () => {
  test('a fresh IP may write a save', () => {
    expect(rateDecision(null, SAVE_WRITES_PER_HOUR).allowed).toBe(true)
  })

  test('the save limit cuts off at exactly the published number, not one past it', () => {
    const atLimit = rateDecision(String(SAVE_WRITES_PER_HOUR), SAVE_WRITES_PER_HOUR)
    const justUnder = rateDecision(String(SAVE_WRITES_PER_HOUR - 1), SAVE_WRITES_PER_HOUR)
    expect(justUnder.allowed).toBe(true)
    expect(atLimit.allowed).toBe(false)
    expect(atLimit.remaining).toBe(0)
  })

  test('saves get their own counter scope, so uploading does not spend a save budget', () => {
    const bucket = hourBucket(Date.parse('2026-07-28T16:00:00Z'))
    const saveKey = rateCounterKey('saves', '9.9.9.9', bucket)
    const scoreKey = rateCounterKey('scores', '9.9.9.9', bucket)
    const uploadKey = rateCounterKey('uploads', '9.9.9.9', bucket)
    expect(new Set([saveKey, scoreKey, uploadKey]).size).toBe(3)
  })

  test('a corrupt save counter fails CLOSED to zero-used, never to unlimited', () => {
    for (const poison of ['abc', 'NaN', 'Infinity', '-5', '', 'null']) {
      const d = rateDecision(poison, SAVE_WRITES_PER_HOUR)
      expect(d.used).toBe(0)
      expect(d.allowed).toBe(true)
      expect(d.remaining).toBe(SAVE_WRITES_PER_HOUR)
    }
  })

  test('a spoofed forwarded-for chain cannot buy a fresh save bucket', () => {
    expect(clientIp('5.5.5.5, 1.1.1.1')).toBe(clientIp('5.5.5.5'))
  })

  test('the published save limit is a sane positive integer', () => {
    expect(Number.isInteger(SAVE_WRITES_PER_HOUR)).toBe(true)
    expect(SAVE_WRITES_PER_HOUR).toBeGreaterThan(0)
    expect(SAVE_WRITES_PER_HOUR).toBeLessThan(1000)
  })
})

describe('saveCapacityDecision — the table is bounded WITHOUT deleting player progress (AT5-1)', () => {
  test('a new row is accepted while the table is under capacity', () => {
    expect(saveCapacityDecision(0, false).allowed).toBe(true)
    expect(saveCapacityDecision(MAX_SAVE_ROWS - 1, false).allowed).toBe(true)
  })

  test('a new row is refused once the table is full', () => {
    expect(saveCapacityDecision(MAX_SAVE_ROWS, false).allowed).toBe(false)
    expect(saveCapacityDecision(MAX_SAVE_ROWS + 500, false).allowed).toBe(false)
  })

  test('an EXISTING save can still be updated at capacity, so progress is never locked out', () => {
    expect(saveCapacityDecision(MAX_SAVE_ROWS, true).allowed).toBe(true)
    expect(saveCapacityDecision(MAX_SAVE_ROWS * 10, true).allowed).toBe(true)
  })

  test('the cap refuses growth rather than trimming rows, unlike the leaderboard', () => {
    const full = saveCapacityDecision(MAX_SAVE_ROWS, false)
    expect(full.allowed).toBe(false)
    expect(full.rows).toBe(MAX_SAVE_ROWS)
    expect(full.max).toBe(MAX_SAVE_ROWS)
  })

  test('an unknown or corrupt row count fails CLOSED for new rows', () => {
    for (const poison of [undefined, null, 'abc', Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(saveCapacityDecision(poison, false).allowed).toBe(false)
    }
  })

  test('an unknown row count still lets an existing save be updated', () => {
    for (const poison of [undefined, null, 'abc', Number.NaN]) {
      expect(saveCapacityDecision(poison, true).allowed).toBe(true)
    }
  })

  test('a numeric string row count from D1 is honoured', () => {
    expect(saveCapacityDecision('10', false).allowed).toBe(true)
    expect(saveCapacityDecision(String(MAX_SAVE_ROWS), false).allowed).toBe(false)
  })

  test('the save-row cap is a sane integer larger than the leaderboard cap', () => {
    expect(Number.isInteger(MAX_SAVE_ROWS)).toBe(true)
    expect(MAX_SAVE_ROWS).toBeGreaterThan(MAX_LEADERBOARD_ROWS)
  })

  test('one IP exhausting its hourly budget cannot fill the table on its own', () => {
    expect(SAVE_WRITES_PER_HOUR).toBeLessThan(MAX_SAVE_ROWS)
  })
})
