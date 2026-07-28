import { describe, expect, test } from 'bun:test'
import {
  BOSS_MAX_HP,
  BOSS_TOUCH_RANGE,
  PLAYER_MAX_HP,
  SHOT_CONE,
  SHOT_DAMAGE,
  SHOT_RANGE,
  aimVector,
  applyDamage,
  bearingToBoss,
  shotWouldHit,
  isLethal,
  rayHitDistance,
  shotsToKill,
  withinBossTouch,
} from '../src/shared/combat'

describe('rayHitDistance', () => {
  test('hits a target straight ahead and returns the along-distance', () => {
    const d = rayHitDistance(0, 0, 0, 1, 0, 10, SHOT_RANGE)
    expect(d).toBeCloseTo(10, 6)
  })

  test('misses a target directly behind the shooter', () => {
    expect(rayHitDistance(0, 0, 0, 1, 0, -10, SHOT_RANGE)).toBeNull()
  })

  test('misses a target beyond max range', () => {
    expect(rayHitDistance(0, 0, 0, 1, 0, SHOT_RANGE + 1, SHOT_RANGE)).toBeNull()
  })

  test('hits at exactly max range (boundary is inclusive)', () => {
    expect(rayHitDistance(0, 0, 0, 1, 0, SHOT_RANGE, SHOT_RANGE)).toBeCloseTo(SHOT_RANGE, 6)
  })

  test('misses a target at zero distance (along <= 0)', () => {
    expect(rayHitDistance(0, 0, 0, 1, 0, 0, SHOT_RANGE)).toBeNull()
  })

  test('cone widens with distance: same lateral offset hits far, misses near', () => {
    const lateral = 3
    expect(rayHitDistance(0, 0, 0, 1, lateral, 40, SHOT_RANGE)).not.toBeNull()
    expect(rayHitDistance(0, 0, 0, 1, lateral, 2, SHOT_RANGE)).toBeNull()
  })

  test('respects the cone half-angle at the boundary', () => {
    const along = 20
    const justInside = SHOT_CONE * along + 1.5 - 0.01
    const justOutside = SHOT_CONE * along + 1.5 + 0.01
    expect(rayHitDistance(0, 0, 0, 1, justInside, along, SHOT_RANGE)).not.toBeNull()
    expect(rayHitDistance(0, 0, 0, 1, justOutside, along, SHOT_RANGE)).toBeNull()
  })

  test('works along an arbitrary yaw, not just +Z', () => {
    const { dx, dz } = aimVector(Math.PI / 2)
    const d = rayHitDistance(0, 0, dx, dz, 15, 0, SHOT_RANGE)
    expect(d).toBeCloseTo(15, 4)
  })

  test('rejects NaN inputs instead of returning a bogus hit', () => {
    expect(rayHitDistance(0, 0, 0, 1, Number.NaN, 10, SHOT_RANGE)).toBeNull()
    expect(rayHitDistance(Number.NaN, 0, 0, 1, 0, 10, SHOT_RANGE)).toBeNull()
  })

  test('is symmetric about the aim axis', () => {
    const left = rayHitDistance(0, 0, 0, 1, -2, 25, SHOT_RANGE)
    const right = rayHitDistance(0, 0, 0, 1, 2, 25, SHOT_RANGE)
    expect(left).toBeCloseTo(right as number, 6)
  })
})

describe('damage model', () => {
  test('a full-hp player survives one shot', () => {
    expect(applyDamage(PLAYER_MAX_HP, SHOT_DAMAGE)).toBe(80)
    expect(isLethal(PLAYER_MAX_HP, SHOT_DAMAGE)).toBe(false)
  })

  test('hp never goes negative', () => {
    expect(applyDamage(10, SHOT_DAMAGE)).toBe(0)
  })

  test('undefined hp is treated as full hp, not as zero', () => {
    expect(applyDamage(undefined, SHOT_DAMAGE)).toBe(PLAYER_MAX_HP - SHOT_DAMAGE)
    expect(isLethal(undefined, SHOT_DAMAGE)).toBe(false)
  })

  test('NaN hp does not produce NaN hp', () => {
    expect(applyDamage(Number.NaN, SHOT_DAMAGE)).toBe(PLAYER_MAX_HP - SHOT_DAMAGE)
  })

  test('exactly-lethal damage is lethal', () => {
    expect(isLethal(SHOT_DAMAGE, SHOT_DAMAGE)).toBe(true)
  })

  test('boss takes a known number of shots to kill', () => {
    expect(shotsToKill(BOSS_MAX_HP, SHOT_DAMAGE)).toBe(5)
  })

  test('five shots exactly empty a full boss', () => {
    let hp: number = BOSS_MAX_HP
    for (let i = 0; i < 5; i++) hp = applyDamage(hp, SHOT_DAMAGE, BOSS_MAX_HP)
    expect(hp).toBe(0)
  })
})

describe('boss touch range', () => {
  test('touches when inside range', () => {
    expect(withinBossTouch(0, 0, 0, BOSS_TOUCH_RANGE - 0.5)).toBe(true)
  })

  test('does not touch when outside range', () => {
    expect(withinBossTouch(0, 0, 0, BOSS_TOUCH_RANGE + 0.5)).toBe(false)
  })

  test('boundary is inclusive', () => {
    expect(withinBossTouch(0, 0, 0, BOSS_TOUCH_RANGE)).toBe(true)
  })
})

describe('bearingToBoss (KE4: no way to find the boss once it is off-screen)', () => {
  test('a boss dead ahead reports zero relative angle and is not behind', () => {
    const b = bearingToBoss(0, 0, 0, 0, 30)
    expect(b.distance).toBeCloseTo(30, 5)
    expect(b.relativeAngle).toBeCloseTo(0, 5)
    expect(b.isBehind).toBe(false)
  })

  test('a boss directly behind is flagged behind', () => {
    const b = bearingToBoss(0, 0, 0, 0, -30)
    expect(b.distance).toBeCloseTo(30, 5)
    expect(Math.abs(b.relativeAngle)).toBeCloseTo(Math.PI, 5)
    expect(b.isBehind).toBe(true)
  })

  test('relative angle is measured against player yaw, not world axes', () => {
    const facingBoss = bearingToBoss(0, 0, Math.PI / 2, 30, 0)
    expect(facingBoss.relativeAngle).toBeCloseTo(0, 5)
    expect(facingBoss.isBehind).toBe(false)
  })

  test('relative angle always stays in [-PI, PI] even for absurd yaw', () => {
    for (const yaw of [-100, -7, 0, 7, 100, Math.PI * 6]) {
      for (const [bx, bz] of [[10, 10], [-10, 4], [0, -22], [3, 0]]) {
        const b = bearingToBoss(0, 0, yaw, bx, bz)
        expect(b.relativeAngle).toBeGreaterThanOrEqual(-Math.PI)
        expect(b.relativeAngle).toBeLessThanOrEqual(Math.PI)
      }
    }
  })

  test('a boss on top of the player reports zero distance without NaN', () => {
    const b = bearingToBoss(5, 5, 1, 5, 5)
    expect(b.distance).toBe(0)
    expect(Number.isNaN(b.relativeAngle)).toBe(false)
  })

  test('distance is euclidean in the xz plane', () => {
    expect(bearingToBoss(0, 0, 0, 3, 4).distance).toBeCloseTo(5, 5)
  })
})

describe('shotWouldHit (KE3: crosshair must reflect real hit geometry)', () => {
  test('dead ahead inside range would hit', () => {
    expect(shotWouldHit(bearingToBoss(0, 0, 0, 0, 20))).toBe(true)
  })

  test('beyond SHOT_RANGE never hits even when perfectly aimed', () => {
    const far = bearingToBoss(0, 0, 0, 0, SHOT_RANGE + 1)
    expect(far.relativeAngle).toBeCloseTo(0, 5)
    expect(shotWouldHit(far)).toBe(false)
  })

  test('the cone edge is the boundary between aim and miss', () => {
    const justInside = { distance: 10, relativeAngle: SHOT_CONE - 0.01, isBehind: false }
    const justOutside = { distance: 10, relativeAngle: SHOT_CONE + 0.01, isBehind: false }
    expect(shotWouldHit(justInside)).toBe(true)
    expect(shotWouldHit(justOutside)).toBe(false)
  })

  test('a boss behind the player is never on target', () => {
    expect(shotWouldHit(bearingToBoss(0, 0, 0, 0, -20))).toBe(false)
  })

  test('the reticle never promises a hit the server refuses, swept over angle and range', () => {
    let onTargetCount = 0
    let disagreements = 0
    for (let deg = -90; deg <= 90; deg += 3) {
      const angle = (deg * Math.PI) / 180
      for (const dist of [5, 15, 25, 40, 55, 59]) {
        const bossX = Math.sin(angle) * dist
        const bossZ = Math.cos(angle) * dist
        const aim = aimVector(0)
        const serverHits =
          rayHitDistance(0, 0, aim.dx, aim.dz, bossX, bossZ, SHOT_RANGE) !== null
        const clientSaysOnTarget = shotWouldHit(bearingToBoss(0, 0, 0, bossX, bossZ))
        if (clientSaysOnTarget) {
          onTargetCount++
          if (!serverHits) disagreements++
        }
      }
    }
    expect(onTargetCount).toBeGreaterThan(20)
    expect(disagreements).toBe(0)
  })
})
