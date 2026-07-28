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

export const RESPAWN_INVULN_MS = 3000

export type ArenaPoint = { x: number; z: number }

const RESPAWN_CANDIDATE_RING_RADII = [12, 24, 40]
const RESPAWN_CANDIDATES_PER_RING = 8

function hasUsableCoordinates(point: ArenaPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
}

export function isInvulnerable(
  respawnAt: number | undefined,
  now: number,
  invulnMs = RESPAWN_INVULN_MS,
): boolean {
  if (typeof respawnAt !== 'number' || !Number.isFinite(respawnAt)) return false
  const msSinceRespawn = now - respawnAt
  const respawnIsInTheFuture = msSinceRespawn < 0
  if (respawnIsInTheFuture) return true
  return msSinceRespawn < invulnMs
}

function respawnCandidatesOutwardFrom(origin: ArenaPoint): ArenaPoint[] {
  const candidates: ArenaPoint[] = [origin]
  for (const radius of RESPAWN_CANDIDATE_RING_RADII) {
    for (let i = 0; i < RESPAWN_CANDIDATES_PER_RING; i++) {
      const angle = (i / RESPAWN_CANDIDATES_PER_RING) * Math.PI * 2
      candidates.push({
        x: origin.x + Math.cos(angle) * radius,
        z: origin.z + Math.sin(angle) * radius,
      })
    }
  }
  return candidates
}

function distanceToNearestHazard(point: ArenaPoint, hazards: ArenaPoint[]): number {
  let nearest = Infinity
  for (const hazard of hazards) {
    const distance = Math.hypot(point.x - hazard.x, point.z - hazard.z)
    if (distance < nearest) nearest = distance
  }
  return nearest
}

export function pickRespawnPoint(
  hazards: ArenaPoint[],
  safeRange: number,
  origin: ArenaPoint = { x: 0, z: 0 },
): ArenaPoint {
  const locatableHazards = hazards.filter(hasUsableCoordinates)
  const candidates = respawnCandidatesOutwardFrom(origin)

  let farthestFromHazards = candidates[0]
  let farthestClearance = distanceToNearestHazard(farthestFromHazards, locatableHazards)

  for (const candidate of candidates) {
    const clearance = distanceToNearestHazard(candidate, locatableHazards)
    const isClearOfEveryHazard = clearance > safeRange
    if (isClearOfEveryHazard) return candidate
    if (clearance > farthestClearance) {
      farthestFromHazards = candidate
      farthestClearance = clearance
    }
  }
  return farthestFromHazards
}

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
