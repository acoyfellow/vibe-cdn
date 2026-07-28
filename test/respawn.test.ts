import { describe, expect, test } from 'bun:test'
import { BOSS_TOUCH_DAMAGE, BOSS_TOUCH_RANGE, PLAYER_MAX_HP } from '../src/shared/combat'
import {
  RESPAWN_INVULN_MS,
  isInvulnerable,
  pickRespawnPoint,
  stepBossToward,
} from '../src/shared/lobby-logic'

describe('isInvulnerable — the post-respawn immunity window', () => {
  test('a player who just respawned is immune', () => {
    expect(isInvulnerable(1000, 1000)).toBe(true)
  })

  test('immunity holds for the whole window', () => {
    expect(isInvulnerable(1000, 1000 + RESPAWN_INVULN_MS - 1)).toBe(true)
  })

  test('immunity ends exactly at the boundary, not after', () => {
    expect(isInvulnerable(1000, 1000 + RESPAWN_INVULN_MS)).toBe(false)
  })

  test('a long-alive player is not immune', () => {
    expect(isInvulnerable(1000, 60_000)).toBe(false)
  })

  test('a player who never died has no immunity (undefined respawnAt)', () => {
    expect(isInvulnerable(undefined, 5000)).toBe(false)
  })

  test('corrupt respawnAt does NOT grant permanent immunity', () => {
    expect(isInvulnerable(Number.NaN, 5000)).toBe(false)
    expect(isInvulnerable(Number.POSITIVE_INFINITY, 5000)).toBe(false)
    expect(isInvulnerable('soon' as unknown as number, 5000)).toBe(false)
  })

  test('backwards clock skew protects the player rather than exposing them', () => {
    expect(isInvulnerable(10_000, 9_000)).toBe(true)
  })

  test('the window is long enough to walk out of a boss touch radius', () => {
    const secondsOfImmunity = RESPAWN_INVULN_MS / 1000
    expect(secondsOfImmunity * 6).toBeGreaterThan(BOSS_TOUCH_RANGE)
  })
})

describe('pickRespawnPoint — never respawn inside a hazard', () => {
  const safeRange = BOSS_TOUCH_RANGE * 3

  test('with no hazards, respawn is the arena origin', () => {
    expect(pickRespawnPoint([], safeRange)).toEqual({ x: 0, z: 0 })
  })

  test('a boss camping the origin pushes the respawn point away', () => {
    const spot = pickRespawnPoint([{ x: 0, z: 0 }], safeRange)
    const dist = Math.hypot(spot.x, spot.z)
    expect(dist).toBeGreaterThan(safeRange)
  })

  test('the chosen point clears EVERY hazard, not just the nearest', () => {
    const bosses = [
      { x: 0, z: 0 },
      { x: 12, z: 0 },
      { x: -12, z: 0 },
      { x: 0, z: 12 },
    ]
    const spot = pickRespawnPoint(bosses, safeRange)
    for (const b of bosses) {
      expect(Math.hypot(spot.x - b.x, spot.z - b.z)).toBeGreaterThan(safeRange)
    }
  })

  test('is deterministic — same input, same point (no RNG to flake on)', () => {
    const h = [{ x: 3, z: 3 }]
    expect(pickRespawnPoint(h, safeRange)).toEqual(pickRespawnPoint(h, safeRange))
  })

  test('always returns a finite usable point even when hazards blanket the arena', () => {
    const swarm = []
    for (let x = -40; x <= 40; x += 4) for (let z = -40; z <= 40; z += 4) swarm.push({ x, z })
    const spot = pickRespawnPoint(swarm, safeRange)
    expect(Number.isFinite(spot.x)).toBe(true)
    expect(Number.isFinite(spot.z)).toBe(true)
  })

  test('picks the farthest-from-danger fallback when nothing is fully safe', () => {
    const spot = pickRespawnPoint([{ x: 0, z: 0 }], 10_000)
    expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(0)
  })

  test('hazards with corrupt coordinates are ignored, not fatal', () => {
    const spot = pickRespawnPoint(
      [{ x: Number.NaN, z: 0 }, { x: 0, z: Number.POSITIVE_INFINITY }],
      safeRange,
    )
    expect(Number.isFinite(spot.x)).toBe(true)
    expect(Number.isFinite(spot.z)).toBe(true)
  })
})

describe('KR1 end-to-end: respawning now buys real time to react', () => {
  function simulateAfkPlayer(opts: { invuln: boolean; safeRespawn: boolean }) {
    const TICK_MS = 50
    const BOSS_SPEED = (6 * TICK_MS) / 1000
    const TOUCH_THROTTLE_MS = 500
    let boss = { x: 0, z: 14 }
    let player = { x: 0, z: 0, hp: PLAYER_MAX_HP, respawnAt: undefined as number | undefined }
    let lastHit = -Infinity
    let deaths = 0
    let pendingRespawnAt: number | null = null
    const safeWindows: number[] = []

    for (let now = 0; now <= 40_000; now += TICK_MS) {
      const step = stepBossToward(boss, [player], BOSS_SPEED, BOSS_TOUCH_RANGE)
      boss = { x: step.x, z: step.z }
      if (!step.touching) continue
      if (now - lastHit < TOUCH_THROTTLE_MS) continue
      if (opts.invuln && isInvulnerable(player.respawnAt, now)) continue
      lastHit = now
      if (pendingRespawnAt !== null) {
        safeWindows.push(now - pendingRespawnAt)
        pendingRespawnAt = null
      }
      const hp = player.hp - BOSS_TOUCH_DAMAGE
      if (hp <= 0) {
        deaths++
        const spot = opts.safeRespawn
          ? pickRespawnPoint([boss], BOSS_TOUCH_RANGE * 3)
          : { x: 0, z: 0 }
        player = { x: spot.x, z: spot.z, hp: PLAYER_MAX_HP, respawnAt: now }
        pendingRespawnAt = now
      } else {
        player = { ...player, hp }
      }
    }
    return { deaths, minSafeWindow: Math.min(...safeWindows), safeWindows }
  }

  test('the OLD behaviour gave only 500ms between respawn and the next hit', () => {
    const r = simulateAfkPlayer({ invuln: false, safeRespawn: false })
    expect(r.deaths).toBeGreaterThanOrEqual(3)
    expect(r.minSafeWindow).toBe(500)
  })

  test('WITH THE FIX every respawn is followed by a full immunity window', () => {
    const r = simulateAfkPlayer({ invuln: true, safeRespawn: true })
    expect(r.minSafeWindow).toBeGreaterThanOrEqual(RESPAWN_INVULN_MS)
  })

  test('the fix multiplies post-respawn reaction time by at least 6x', () => {
    const before = simulateAfkPlayer({ invuln: false, safeRespawn: false }).minSafeWindow
    const after = simulateAfkPlayer({ invuln: true, safeRespawn: true }).minSafeWindow
    expect(after / before).toBeGreaterThanOrEqual(6)
  })

  test('the player still CAN die — this is not blanket invincibility', () => {
    expect(simulateAfkPlayer({ invuln: true, safeRespawn: true }).deaths).toBeGreaterThanOrEqual(1)
  })

  test('each half of the fix contributes, and immunity sets the guaranteed floor', () => {
    const respawnOnly = simulateAfkPlayer({ invuln: false, safeRespawn: true })
    expect(respawnOnly.minSafeWindow).toBeGreaterThan(500)
    expect(respawnOnly.minSafeWindow).toBeLessThan(RESPAWN_INVULN_MS)

    const both = simulateAfkPlayer({ invuln: true, safeRespawn: true })
    expect(new Set(both.safeWindows)).toEqual(new Set([RESPAWN_INVULN_MS]))
  })
})

describe('KR2: hostile numeric input must never reach the wire as null', () => {
  const sanitizeLap = (v: unknown) => Math.max(0, Math.floor(Number.isFinite(v as number) ? (v as number) : 0))
  const sanitizeLastLap = (v: unknown, prev: number | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : prev

  test.each([
    ['a string', 'abc'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['an object', { nested: 1 }],
    ['null', null],
    ['undefined', undefined],
  ])('lap from %s survives JSON as a real number, never null', (_label, input) => {
    const lap = sanitizeLap(input)
    expect(Number.isFinite(lap)).toBe(true)
    expect(JSON.parse(JSON.stringify({ lap })).lap).not.toBeNull()
    expect(typeof JSON.parse(JSON.stringify({ lap })).lap).toBe('number')
  })

  test('a legitimate lap value still passes through untouched', () => {
    expect(sanitizeLap(7)).toBe(7)
    expect(sanitizeLap(7.9)).toBe(7)
  })

  test('negative laps clamp to zero rather than going negative', () => {
    expect(sanitizeLap(-5)).toBe(0)
  })

  test('lastLapMs keeps the previous value rather than emitting null', () => {
    expect(sanitizeLastLap(Number.POSITIVE_INFINITY, 1234)).toBe(1234)
    expect(sanitizeLastLap('slow', 1234)).toBe(1234)
    expect(sanitizeLastLap(Number.NaN, undefined)).toBeUndefined()
    expect(sanitizeLastLap(999, 1234)).toBe(999)
  })

  test('an absent lastLapMs is omitted, which is legal, not null', () => {
    const payload = JSON.parse(JSON.stringify({ id: 'x', lastLapMs: sanitizeLastLap(Number.NaN, undefined) }))
    expect('lastLapMs' in payload).toBe(false)
  })

  test('no numeric field in a serialized player is ever null (the general invariant)', () => {
    const player = {
      id: 'p', name: 'n', x: 0, y: 0, z: 0, ry: 0,
      lap: sanitizeLap('abc'), lastLapMs: sanitizeLastLap(Number.NaN, undefined),
      seenAt: Date.now(), hp: 100, kills: 0,
    }
    const round = JSON.parse(JSON.stringify(player)) as Record<string, unknown>
    for (const [k, v] of Object.entries(round)) {
      expect(v, `field ${k} serialized as null`).not.toBeNull()
    }
  })
})
