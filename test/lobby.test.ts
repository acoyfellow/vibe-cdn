import { describe, expect, test } from 'bun:test'
import { backfillEntity, leaderFrom, shouldPersist } from '../src/shared/lobby-logic'
import {
  BOSS_MAX_HP,
  FIRE_COOLDOWN_MS,
  SPAWN_BURST,
  SPAWN_COOLDOWN_MS,
  checkCooldown,
  takeToken,
} from '../src/shared/combat'
import type { ArenaEntity, LobbyPlayer } from '../src/shared/contracts'

function player(over: Partial<LobbyPlayer> & { id: string }): LobbyPlayer {
  return { id: over.id, name: over.id, x: 0, y: 0, z: 0, ry: 0, seenAt: 0, ...over }
}

describe('leaderFrom (K5: leaderId keyed on a lap message no client sends)', () => {
  test('no leader when nobody has a kill', () => {
    expect(leaderFrom([player({ id: 'a' }), player({ id: 'b' })])).toBeUndefined()
  })

  test('the highest kill count leads', () => {
    const id = leaderFrom([
      player({ id: 'a', kills: 1 }),
      player({ id: 'b', kills: 4 }),
      player({ id: 'c', kills: 2 }),
    ])
    expect(id).toBe('b')
  })

  test('a player with kills beats a player with only laps', () => {
    const id = leaderFrom([player({ id: 'a', lap: 99 }), player({ id: 'b', kills: 1 })])
    expect(id).toBe('b')
  })

  test('lap alone never produces a leader (the old behaviour)', () => {
    expect(leaderFrom([player({ id: 'a', lap: 5 })])).toBeUndefined()
  })

  test('ties break deterministically by id, not by iteration order', () => {
    const forward = leaderFrom([player({ id: 'a', kills: 3 }), player({ id: 'b', kills: 3 })])
    const reverse = leaderFrom([player({ id: 'b', kills: 3 }), player({ id: 'a', kills: 3 })])
    expect(forward).toBe('a')
    expect(reverse).toBe('a')
    expect(forward).toBe(reverse)
  })

  test('an empty room has no leader', () => {
    expect(leaderFrom([])).toBeUndefined()
  })

  test('zero and negative kills do not lead', () => {
    expect(leaderFrom([player({ id: 'a', kills: 0 }), player({ id: 'b', kills: -1 })])).toBeUndefined()
  })
})

describe('checkCooldown (K1: fire was unbounded)', () => {
  test('a first shot is always allowed', () => {
    expect(checkCooldown(undefined, 1000, FIRE_COOLDOWN_MS)).toBe(true)
  })

  test('an immediate second shot is refused', () => {
    expect(checkCooldown(1000, 1000, FIRE_COOLDOWN_MS)).toBe(false)
  })

  test('a shot just inside the cooldown is refused', () => {
    expect(checkCooldown(1000, 1000 + FIRE_COOLDOWN_MS - 1, FIRE_COOLDOWN_MS)).toBe(false)
  })

  test('a shot exactly at the cooldown is allowed', () => {
    expect(checkCooldown(1000, 1000 + FIRE_COOLDOWN_MS, FIRE_COOLDOWN_MS)).toBe(true)
  })

  test('a corrupt lastAt does not lock the weapon forever', () => {
    expect(checkCooldown(Number.NaN, 5000, FIRE_COOLDOWN_MS)).toBe(true)
    expect(checkCooldown(Number.POSITIVE_INFINITY, 5000, FIRE_COOLDOWN_MS)).toBe(true)
  })

  test('a 1000-shot flood is throttled to the cooldown rate', () => {
    let last: number | undefined
    let allowed = 0
    for (let t = 0; t < 1000; t++) {
      if (checkCooldown(last, t, FIRE_COOLDOWN_MS)) {
        allowed++
        last = t
      }
    }
    expect(allowed).toBeLessThanOrEqual(Math.ceil(1000 / FIRE_COOLDOWN_MS) + 1)
    expect(allowed).toBeGreaterThan(0)
  })
})

describe('takeToken (K1: spawn was unbounded)', () => {
  test('a cold gate allows a burst then refuses', () => {
    let gate = undefined as ReturnType<typeof takeToken>['gate'] | undefined
    let allowed = 0
    for (let i = 0; i < 20; i++) {
      const r = takeToken(gate, 0, SPAWN_COOLDOWN_MS, SPAWN_BURST)
      gate = r.gate
      if (r.ok) allowed++
    }
    expect(allowed).toBe(SPAWN_BURST)
  })

  test('tokens refill over time', () => {
    let gate = undefined as ReturnType<typeof takeToken>['gate'] | undefined
    for (let i = 0; i < SPAWN_BURST; i++) gate = takeToken(gate, 0, SPAWN_COOLDOWN_MS, SPAWN_BURST).gate
    expect(takeToken(gate, 0, SPAWN_COOLDOWN_MS, SPAWN_BURST).ok).toBe(false)
    expect(takeToken(gate, SPAWN_COOLDOWN_MS, SPAWN_COOLDOWN_MS, SPAWN_BURST).ok).toBe(true)
  })

  test('refill never exceeds the burst cap after a long idle', () => {
    let gate = { allowedAt: 0, tokens: 0 }
    const r = takeToken(gate, 10_000_000, SPAWN_COOLDOWN_MS, SPAWN_BURST)
    expect(r.ok).toBe(true)
    expect(r.gate.tokens).toBe(SPAWN_BURST - 1)
  })

  test('a corrupt gate is repaired instead of trusted', () => {
    const r = takeToken({ allowedAt: Number.NaN, tokens: 999 }, 500, SPAWN_COOLDOWN_MS, SPAWN_BURST)
    expect(r.ok).toBe(true)
    expect(r.gate.tokens).toBeLessThanOrEqual(SPAWN_BURST)
  })
})

describe('backfillEntity (K6: legacy entities lack hp/maxHp)', () => {
  function entity(over: Partial<ArenaEntity>): ArenaEntity {
    return { id: 'e1', kind: 'boss', x: 0, y: 0, z: 0, ry: 0, scale: 1, createdAt: 0, ...over }
  }

  test('a legacy boss with no hp gets full hp on load', () => {
    const out = backfillEntity(entity({ hp: undefined, maxHp: undefined }))
    expect(out.hp).toBe(BOSS_MAX_HP)
    expect(out.maxHp).toBe(BOSS_MAX_HP)
  })

  test('an in-progress boss keeps its damaged hp', () => {
    const out = backfillEntity(entity({ hp: 40, maxHp: BOSS_MAX_HP }))
    expect(out.hp).toBe(40)
  })

  test('a prop is left alone', () => {
    const out = backfillEntity(entity({ kind: 'prop', hp: undefined }))
    expect(out.hp).toBeUndefined()
  })

  test('a boss at 0 hp is not silently revived', () => {
    const out = backfillEntity(entity({ hp: 0, maxHp: BOSS_MAX_HP }))
    expect(out.hp).toBe(0)
  })
})

describe('shouldPersist (K2: a storage write on every 20Hz tick)', () => {
  const MIN = 1000

  test('a clean state never writes', () => {
    expect(shouldPersist(false, 0, 999_999, MIN)).toBe(false)
  })

  test('a dirty state writes once the interval has passed', () => {
    expect(shouldPersist(true, 0, MIN, MIN)).toBe(true)
  })

  test('a dirty state inside the interval defers', () => {
    expect(shouldPersist(true, 0, MIN - 1, MIN)).toBe(false)
  })

  test('20Hz of continuous boss movement collapses to ~1 write/sec', () => {
    const TICK_MS = 50
    const SECONDS = 10
    let lastPersistAt = 0
    let writes = 0
    for (let t = TICK_MS; t <= SECONDS * 1000; t += TICK_MS) {
      if (shouldPersist(true, lastPersistAt, t, MIN)) {
        writes++
        lastPersistAt = t
      }
    }
    const ticks = (SECONDS * 1000) / TICK_MS
    expect(ticks).toBe(200)
    expect(writes).toBe(SECONDS)
    expect(writes).toBeLessThan(ticks / 10)
  })

  test('a corrupt lastPersistAt does not wedge persistence off', () => {
    expect(shouldPersist(true, Number.NaN, 500, MIN)).toBe(true)
  })
})
