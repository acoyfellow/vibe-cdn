export const PLAYER_MAX_HP = 100
export const BOSS_MAX_HP = 100
export const SHOT_RANGE = 60
export const SHOT_CONE = 0.35
export const SHOT_PERP_SLACK = 1.5
export const SHOT_DAMAGE = 20
export const BOSS_TOUCH_RANGE = 4
export const BOSS_TOUCH_DAMAGE = 8

export const FIRE_COOLDOWN_MS = 180
export const SPAWN_COOLDOWN_MS = 1000
export const SPAWN_BURST = 3

export type RateGate = { allowedAt: number; tokens: number }

export function checkCooldown(lastAt: number | undefined, now: number, cooldownMs: number): boolean {
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true
  return now - lastAt >= cooldownMs
}

export function takeToken(gate: RateGate | undefined, now: number, refillMs: number, burst: number): { ok: boolean; gate: RateGate } {
  const current: RateGate = gate && Number.isFinite(gate.allowedAt) ? gate : { allowedAt: 0, tokens: burst }
  const elapsed = Math.max(0, now - current.allowedAt)
  const refilled = Math.min(burst, current.tokens + Math.floor(elapsed / refillMs))
  if (refilled <= 0) return { ok: false, gate: { allowedAt: current.allowedAt, tokens: 0 } }
  return { ok: true, gate: { allowedAt: now, tokens: refilled - 1 } }
}

export function rayHitDistance(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  tx: number,
  tz: number,
  maxDist: number,
): number | null {
  const relX = tx - ox
  const relZ = tz - oz
  const along = relX * dx + relZ * dz
  if (!Number.isFinite(along)) return null
  if (along <= 0 || along > maxDist) return null
  const perpX = relX - along * dx
  const perpZ = relZ - along * dz
  const perp = Math.hypot(perpX, perpZ)
  if (perp > SHOT_CONE * along + SHOT_PERP_SLACK) return null
  return along
}

export function aimVector(ry: number): { dx: number; dz: number } {
  return { dx: Math.sin(ry), dz: Math.cos(ry) }
}

export function applyDamage(hp: number | undefined, damage: number, maxHp = PLAYER_MAX_HP): number {
  const current = typeof hp === 'number' && Number.isFinite(hp) ? hp : maxHp
  return Math.max(0, current - damage)
}

export function isLethal(hp: number | undefined, damage: number, maxHp = PLAYER_MAX_HP): boolean {
  return applyDamage(hp, damage, maxHp) <= 0
}

export function shotsToKill(maxHp = BOSS_MAX_HP, damage = SHOT_DAMAGE): number {
  if (damage <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(maxHp / damage)
}

export function withinBossTouch(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  range = BOSS_TOUCH_RANGE,
): boolean {
  return Math.hypot(ax - bx, az - bz) <= range
}
