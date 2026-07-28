import { BOSS_MAX_HP } from './combat'
import type { ArenaEntity, LobbyPlayer } from './contracts'

export function leaderFrom(players: LobbyPlayer[]): string | undefined {
  let best: LobbyPlayer | undefined
  for (const p of players) {
    const kills = p.kills ?? 0
    if (kills <= 0) continue
    const bestKills = best?.kills ?? 0
    if (!best || kills > bestKills || (kills === bestKills && p.id < best.id)) best = p
  }
  return best?.id
}

export const RESPAWN_GRACE_MS = 700

export function moveIsFromCurrentRespawnEpoch(input: {
  playerEpoch: number
  messageEpoch?: number
  respawnAt?: number
  now: number
  graceMs?: number
}): boolean {
  const grace = input.graceMs ?? RESPAWN_GRACE_MS
  const epoch = Number.isFinite(input.playerEpoch) ? input.playerEpoch : 0
  if (typeof input.messageEpoch === 'number' && Number.isFinite(input.messageEpoch)) {
    return input.messageEpoch >= epoch
  }
  if (typeof input.respawnAt !== 'number' || !Number.isFinite(input.respawnAt)) return true
  return input.now - input.respawnAt >= grace
}

export function shouldPersist(dirty: boolean, lastPersistAt: number, now: number, minIntervalMs: number): boolean {
  if (!dirty) return false
  if (!Number.isFinite(lastPersistAt)) return true
  return now - lastPersistAt >= minIntervalMs
}

export function backfillEntity(e: ArenaEntity): ArenaEntity {
  if (e.kind !== 'boss') return e
  if (typeof e.hp === 'number' && typeof e.maxHp === 'number') return e
  return { ...e, hp: e.hp ?? BOSS_MAX_HP, maxHp: e.maxHp ?? BOSS_MAX_HP }
}

export const MAX_ENTITIES = 64

export function entityToEvict(
  entities: ArenaEntity[],
  max = MAX_ENTITIES,
): ArenaEntity | undefined {
  if (entities.length < max) return undefined
  let oldest: ArenaEntity | undefined
  for (const e of entities) {
    if (!oldest || e.createdAt < oldest.createdAt) oldest = e
  }
  return oldest
}

export function bossAlreadyExists(entities: ArenaEntity[]): boolean {
  return entities.some((e) => e.kind === 'boss')
}

export type BossStep = {
  x: number
  z: number
  ry: number
  moved: boolean
  distToTargetBeforeStep: number
  touching: boolean
}

export function stepBossToward(
  boss: { x: number; z: number; ry?: number },
  players: { x: number; z: number }[],
  speed: number,
  touchRange: number,
): BossStep {
  const base = {
    x: boss.x,
    z: boss.z,
    ry: boss.ry ?? 0,
    moved: false,
    distToTargetBeforeStep: Infinity,
    touching: false,
  }
  let target: { x: number; z: number } | undefined
  let bestDist = Infinity
  for (const p of players) {
    const d = (p.x - boss.x) ** 2 + (p.z - boss.z) ** 2
    if (d < bestDist) {
      bestDist = d
      target = p
    }
  }
  if (!target) return base
  const dx = target.x - boss.x
  const dz = target.z - boss.z
  const len = Math.hypot(dx, dz)
  let { x, z, ry } = base
  let moved = false
  if (len > 0.5) {
    x = boss.x + (dx / len) * speed
    z = boss.z + (dz / len) * speed
    ry = Math.atan2(dx, dz)
    moved = true
  }
  return { x, z, ry, moved, distToTargetBeforeStep: len, touching: len <= touchRange }
}

export function bossTouchReady(lastHitAt: number | undefined, now: number, throttleMs = 500): boolean {
  if (typeof lastHitAt !== 'number' || !Number.isFinite(lastHitAt)) return true
  return now - lastHitAt >= throttleMs
}
