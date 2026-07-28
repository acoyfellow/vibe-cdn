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
