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
