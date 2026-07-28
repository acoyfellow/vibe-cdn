import { describe, expect, test } from 'bun:test'
import {
  BOSS_TOUCH_DAMAGE,
  BOSS_TOUCH_RANGE,
  PLAYER_MAX_HP,
  applyDamage,
  isLethal,
} from '../src/shared/combat'
import {
  MAX_ENTITIES,
  backfillEntity,
  bossAlreadyExists,
  bossTouchReady,
  entityToEvict,
  stepBossToward,
} from '../src/shared/lobby-logic'
import type { ArenaEntity } from '../src/shared/contracts'


function ent(over: Partial<ArenaEntity> & { id: string }): ArenaEntity {
  return {
    kind: 'prop',
    x: 0,
    y: 0,
    z: 0,
    createdAt: 0,
    ...over,
  } as ArenaEntity
}

describe('entity eviction (MAX_ENTITIES cap)', () => {
  test('no eviction while under the cap', () => {
    expect(entityToEvict([ent({ id: 'a' })], 4)).toBeUndefined()
  })

  test('no eviction at exactly one below the cap', () => {
    const list = [ent({ id: 'a' }), ent({ id: 'b' }), ent({ id: 'c' })]
    expect(entityToEvict(list, 4)).toBeUndefined()
  })

  test('evicts the OLDEST by createdAt once at the cap', () => {
    const list = [
      ent({ id: 'new', createdAt: 300 }),
      ent({ id: 'old', createdAt: 100 }),
      ent({ id: 'mid', createdAt: 200 }),
    ]
    expect(entityToEvict(list, 3)?.id).toBe('old')
  })

  test('eviction does not depend on array order', () => {
    const a = [ent({ id: 'x', createdAt: 5 }), ent({ id: 'y', createdAt: 1 })]
    const b = [ent({ id: 'y', createdAt: 1 }), ent({ id: 'x', createdAt: 5 })]
    expect(entityToEvict(a, 2)?.id).toBe('y')
    expect(entityToEvict(b, 2)?.id).toBe('y')
  })

  test('the real cap is 64 and an empty world evicts nothing', () => {
    expect(MAX_ENTITIES).toBe(64)
    expect(entityToEvict([], MAX_ENTITIES)).toBeUndefined()
  })

  test('a world already OVER the cap still yields the oldest (never undefined)', () => {
    const list = Array.from({ length: 70 }, (_, i) => ent({ id: `e${i}`, createdAt: 1000 - i }))
    expect(entityToEvict(list, MAX_ENTITIES)?.id).toBe('e69')
  })
})

describe('duplicate boss spawn guard', () => {
  test('empty world has no boss', () => {
    expect(bossAlreadyExists([])).toBe(false)
  })

  test('props alone do not count as a boss', () => {
    expect(bossAlreadyExists([ent({ id: 'a' }), ent({ id: 'b', kind: 'prop' })])).toBe(false)
  })

  test('one boss anywhere in the list is detected', () => {
    const list = [ent({ id: 'a' }), ent({ id: 'b', kind: 'boss' }), ent({ id: 'c' })]
    expect(bossAlreadyExists(list)).toBe(true)
  })
})

describe('boss chase step (deterministic, no clock)', () => {
  const SPEED = 0.3

  test('no players means no movement', () => {
    const s = stepBossToward({ x: 5, z: 5 }, [], SPEED, BOSS_TOUCH_RANGE)
    expect(s.moved).toBe(false)
    expect(s.x).toBe(5)
    expect(s.z).toBe(5)
    expect(s.touching).toBe(false)
  })

  test('moves toward the only player, by exactly SPEED', () => {
    const s = stepBossToward({ x: 0, z: 0 }, [{ x: 0, z: 10 }], SPEED, BOSS_TOUCH_RANGE)
    expect(s.moved).toBe(true)
    expect(s.z).toBeCloseTo(SPEED, 6)
    expect(s.x).toBeCloseTo(0, 6)
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(SPEED, 6)
  })

  test('picks the NEAREST player, not the first', () => {
    const s = stepBossToward({ x: 0, z: 0 }, [{ x: 0, z: 40 }, { x: 0, z: -3 }], SPEED, BOSS_TOUCH_RANGE)
    expect(s.z).toBeLessThan(0)
  })

  test('stops jittering when already on top of the target', () => {
    const s = stepBossToward({ x: 1, z: 1 }, [{ x: 1.1, z: 1.1 }], SPEED, BOSS_TOUCH_RANGE)
    expect(s.moved).toBe(false)
    expect(s.touching).toBe(true)
  })

  test('reports touching only inside BOSS_TOUCH_RANGE', () => {
    const near = stepBossToward({ x: 0, z: 0 }, [{ x: 0, z: BOSS_TOUCH_RANGE - 0.1 }], SPEED, BOSS_TOUCH_RANGE)
    const far = stepBossToward({ x: 0, z: 0 }, [{ x: 0, z: BOSS_TOUCH_RANGE + 0.1 }], SPEED, BOSS_TOUCH_RANGE)
    expect(near.touching).toBe(true)
    expect(far.touching).toBe(false)
  })

  test('faces the direction it moves (ry matches atan2 of the delta)', () => {
    const s = stepBossToward({ x: 0, z: 0 }, [{ x: 10, z: 0 }], SPEED, BOSS_TOUCH_RANGE)
    expect(s.ry).toBeCloseTo(Math.atan2(10, 0), 6)
  })

  test('repeated steps converge on the player and never overshoot into orbit', () => {
    let boss = { x: 0, z: 0, ry: 0 }
    const player = [{ x: 0, z: 12 }]
    let last = Infinity
    for (let i = 0; i < 200; i++) {
      const s = stepBossToward(boss, player, SPEED, BOSS_TOUCH_RANGE)
      boss = { x: s.x, z: s.z, ry: s.ry }
      expect(s.distToTargetBeforeStep).toBeLessThanOrEqual(last + 1e-9)
      last = s.distToTargetBeforeStep
      if (!s.moved) break
    }
    expect(last).toBeLessThanOrEqual(0.5)
  })
})

describe('boss contact damage throttle', () => {
  test('first ever touch is allowed', () => {
    expect(bossTouchReady(undefined, 1_000)).toBe(true)
  })

  test('a second touch inside 500ms is refused', () => {
    expect(bossTouchReady(1_000, 1_400)).toBe(false)
  })

  test('exactly 500ms later is allowed', () => {
    expect(bossTouchReady(1_000, 1_500)).toBe(true)
  })

  test('a non-finite last-hit does not wedge the boss permanently', () => {
    expect(bossTouchReady(Number.NaN, 5_000)).toBe(true)
  })

  test('throttle means a standing player loses at most BOSS_TOUCH_DAMAGE per 500ms', () => {
    let hp = PLAYER_MAX_HP
    let lastAt: number | undefined
    let landed = 0
    for (let t = 0; t <= 1000; t += 50) {
      if (bossTouchReady(lastAt, t)) {
        lastAt = t
        hp = applyDamage(hp, BOSS_TOUCH_DAMAGE)
        landed++
      }
    }
    expect(landed).toBe(3)
    expect(hp).toBe(PLAYER_MAX_HP - 3 * BOSS_TOUCH_DAMAGE)
  })

  test('a boss can eventually kill a full-HP player, and the kill is flagged lethal', () => {
    let hp = PLAYER_MAX_HP
    let lastAt: number | undefined
    let lethalSeen = false
    for (let t = 0; t < 60_000 && hp > 0; t += 50) {
      if (!bossTouchReady(lastAt, t)) continue
      lastAt = t
      if (isLethal(hp, BOSS_TOUCH_DAMAGE)) lethalSeen = true
      hp = applyDamage(hp, BOSS_TOUCH_DAMAGE)
    }
    expect(hp).toBe(0)
    expect(lethalSeen).toBe(true)
  })
})

describe('entity rehydration after hibernation', () => {
  test('a legacy stored boss with no hp fields is backfilled to full', () => {
    const stored = ent({ id: 'b', kind: 'boss' })
    const out = backfillEntity(stored)
    expect(out.hp).toBe(100)
    expect(out.maxHp).toBe(100)
  })

  test('a WOUNDED boss keeps its hp across rehydration (does not heal on wake)', () => {
    const stored = ent({ id: 'b', kind: 'boss', hp: 20, maxHp: 100 })
    expect(backfillEntity(stored).hp).toBe(20)
  })

  test('non-boss entities are returned untouched', () => {
    const prop = ent({ id: 'p', kind: 'prop' })
    expect(backfillEntity(prop)).toEqual(prop)
    expect(backfillEntity(prop).hp).toBeUndefined()
  })

  test('a full round-trip through JSON (what storage actually does) preserves hp', () => {
    const boss = ent({ id: 'b', kind: 'boss', hp: 40, maxHp: 100, label: 'ROOM BOSS' })
    const revived = backfillEntity(JSON.parse(JSON.stringify(boss)) as ArenaEntity)
    expect(revived.hp).toBe(40)
    expect(revived.label).toBe('ROOM BOSS')
  })
})
