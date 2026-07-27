// Multiplayer lobby + race room — now an Agent (Cloudflare Agents SDK).
//
// What changed vs the raw-WebSocket version:
//   1. Extends `Agent` (partyserver `Server`) with `static options.hibernate = true`.
//      Idle rooms can be evicted from memory and cost ~$0; incoming messages wake it.
//   2. Per-player state lives in HIBERNATION-SAFE connection state
//      (`connection.setState`) instead of an in-memory `Map<WebSocket, player>`,
//      so a wake after eviction rebuilds every player from durable connection state.
//   3. The room IS an Agent, so an AI driver / `think` builder can live in this
//      same class (see `addAiDriver`, stubbed) with zero new infra.
//
// Wire protocol is BYTE-IDENTICAL to the old DO: clients still send
// join/move/lap/ping and read hello/snapshot/state/pong/error. The tick still
// coalesces move/lap at 20 Hz; per-message we only mutate connection state.

import { Agent, type Connection, type ConnectionContext, type WSMessage } from 'agents'
import type { Env } from './env'
import type {
  ArenaEntity,
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
} from '../shared/contracts'

const TICK_HZ = 20
const TICK_MS = 1000 / TICK_HZ
const MAX_ENTITIES = 64
const ENTITIES_KEY = 'arena:entities'
const PLAYER_MAX_HP = 100
const BOSS_MAX_HP = 100
const SHOT_RANGE = 60
const SHOT_CONE = 0.35
const SHOT_DAMAGE = 20
const BOSS_TOUCH_RANGE = 4
const BOSS_TOUCH_DAMAGE = 8

type PlayerState = LobbyPlayer & { lastSeq: number }

export class LobbyDO extends Agent<Env> {
  static options = { hibernate: true }

  private tick = 0
  private tickHandle: ReturnType<typeof setInterval> | null = null
  private entities = new Map<string, ArenaEntity>()
  private entitiesLoaded = false
  private lastBossHit = new Map<string, number>()

  private async ensureEntitiesLoaded(): Promise<void> {
    if (this.entitiesLoaded) return
    const stored = await this.ctx.storage.get<ArenaEntity[]>(ENTITIES_KEY)
    if (stored) for (const e of stored) this.entities.set(e.id, e)
    this.entitiesLoaded = true
  }

  private async persistEntities(): Promise<void> {
    await this.ctx.storage.put(ENTITIES_KEY, [...this.entities.values()])
  }

  onConnect(connection: Connection, _ctx: ConnectionContext): void {
    void this.ensureEntitiesLoaded()
    const id = connection.id.slice(0, 8)
    const player: PlayerState = {
      id,
      name: `player-${id}`,
      x: 0,
      y: 0,
      z: 0,
      ry: 0,
      lap: 0,
      lastLapMs: undefined,
      seenAt: Date.now(),
      lastSeq: -1,
      hp: PLAYER_MAX_HP,
      kills: 0,
    }
    connection.setState(player)

    this.sendTo(connection, {
      type: 'hello',
      id,
      tickRate: TICK_HZ,
      serverNow: Date.now(),
    })
    // One legacy snapshot so the existing lobby panel paints immediately.
    this.broadcastSnapshot()
    this.ensureTickRunning()
  }

  onMessage(connection: Connection, raw: WSMessage): void {
    const player = connection.state as PlayerState | null
    if (!player) return

    let message: LobbyClientMessage
    try {
      message = JSON.parse(String(raw)) as LobbyClientMessage
    } catch {
      this.sendTo(connection, { type: 'error', message: 'invalid json' })
      return
    }

    switch (message.type) {
      case 'join': {
        connection.setState({
          ...player,
          name: String(message.name || player.name).slice(0, 24),
          seenAt: Date.now(),
        })
        this.broadcastSnapshot()
        return
      }
      case 'move': {
        const seq = typeof message.seq === 'number' ? message.seq : 0
        if (seq !== 0 && seq <= player.lastSeq) return // drop reorders
        connection.setState({
          ...player,
          lastSeq: seq,
          x: finite(message.x),
          y: finite(message.y),
          z: finite(message.z),
          ry: typeof message.ry === 'number' ? finite(message.ry) : player.ry,
          seenAt: Date.now(),
        })
        // No broadcast — the tick fans out.
        return
      }
      case 'lap': {
        connection.setState({
          ...player,
          lap: Math.max(0, Math.floor(message.lap)),
          lastLapMs:
            typeof message.lastLapMs === 'number' ? Math.floor(message.lastLapMs) : player.lastLapMs,
          seenAt: Date.now(),
        })
        // No broadcast — tick handles it.
        return
      }
      case 'ping': {
        this.sendTo(connection, { type: 'pong', t: message.t, now: Date.now() })
        return
      }
      case 'fire': {
        this.resolveShot(connection, player, finite(message.x), finite(message.z), finite(message.ry))
        return
      }
      case 'spawn': {
        void this.spawnEntity({
          kind: message.kind === 'boss' ? 'boss' : 'prop',
          url: message.url,
          x: finite(message.x),
          z: finite(message.z),
          ry: typeof message.ry === 'number' ? finite(message.ry) : 0,
          scale: typeof message.scale === 'number' ? clampScale(message.scale) : 1,
          label: message.label,
          ownerId: player.id,
        })
        return
      }
    }
  }

  private async spawnEntity(input: {
    kind: ArenaEntity['kind']
    url?: string
    x: number
    z: number
    ry: number
    scale: number
    label?: string
    ownerId?: string
  }): Promise<void> {
    await this.ensureEntitiesLoaded()
    if (this.entities.size >= MAX_ENTITIES) {
      const oldest = [...this.entities.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
      if (oldest) this.entities.delete(oldest.id)
    }
    const id = `e_${Math.random().toString(36).slice(2, 10)}`
    const entity: ArenaEntity = {
      id,
      kind: input.kind,
      url: input.url ? String(input.url).slice(0, 256) : undefined,
      x: input.x,
      y: 0,
      z: input.z,
      ry: input.ry,
      scale: input.scale,
      label: input.label ? String(input.label).slice(0, 40) : undefined,
      ownerId: input.ownerId,
      createdAt: Date.now(),
      hp: input.kind === 'boss' ? BOSS_MAX_HP : undefined,
      maxHp: input.kind === 'boss' ? BOSS_MAX_HP : undefined,
    }
    this.entities.set(id, entity)
    await this.persistEntities()
    this.ensureTickRunning()
  }

  private resolveShot(
    shooter: Connection,
    player: PlayerState,
    x: number,
    z: number,
    ry: number,
  ): void {
    const dirX = Math.sin(ry)
    const dirZ = Math.cos(ry)
    let hitId: string | undefined
    let hitKind: 'player' | 'boss' | undefined
    let bestDist = SHOT_RANGE

    for (const c of this.getConnections<PlayerState>()) {
      const t = c.state
      if (!t || t.id === player.id || (t.hp ?? 0) <= 0) continue
      const d = this.rayHitDistance(x, z, dirX, dirZ, t.x, t.z, bestDist)
      if (d !== null && d < bestDist) {
        bestDist = d
        hitId = t.id
        hitKind = 'player'
      }
    }
    for (const e of this.entities.values()) {
      if (e.kind !== 'boss') continue
      if (typeof e.hp !== 'number') {
        e.hp = BOSS_MAX_HP
        e.maxHp = BOSS_MAX_HP
      }
      if (e.hp <= 0) continue
      const d = this.rayHitDistance(x, z, dirX, dirZ, e.x, e.z, bestDist)
      if (d !== null && d < bestDist) {
        bestDist = d
        hitId = e.id
        hitKind = 'boss'
      }
    }

    const shot: LobbyServerMessage = {
      type: 'shot',
      fromId: player.id,
      x,
      z,
      ry,
      range: hitId ? bestDist : SHOT_RANGE,
      hitId,
      hitKind,
    }
    this.broadcast(JSON.stringify(shot))

    if (hitKind === 'player' && hitId) {
      for (const c of this.getConnections<PlayerState>()) {
        const t = c.state
        if (!t || t.id !== hitId) continue
        const hp = (t.hp ?? PLAYER_MAX_HP) - SHOT_DAMAGE
        if (hp <= 0) {
          c.setState({ ...t, hp: PLAYER_MAX_HP, x: 0, z: 0, seenAt: Date.now() })
          shooter.setState({ ...player, kills: (player.kills ?? 0) + 1 })
        } else {
          c.setState({ ...t, hp, seenAt: Date.now() })
        }
      }
    } else if (hitKind === 'boss' && hitId) {
      const boss = this.entities.get(hitId)
      if (boss) {
        boss.hp = (boss.hp ?? BOSS_MAX_HP) - SHOT_DAMAGE
        if (boss.hp <= 0) {
          this.entities.delete(hitId)
          shooter.setState({ ...player, kills: (player.kills ?? 0) + 1 })
        }
        void this.persistEntities()
      }
    }
  }

  private rayHitDistance(
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
    if (along <= 0 || along > maxDist) return null
    const perpX = relX - along * dx
    const perpZ = relZ - along * dz
    const perp = Math.hypot(perpX, perpZ)
    if (perp > SHOT_CONE * along + 1.5) return null
    return along
  }

  onClose(_connection: Connection): void {
    this.broadcastSnapshot()
    if (this.connectionCount() === 0) this.stopTick()
  }

  onError(_connection: Connection): void {
    this.broadcastSnapshot()
    if (this.connectionCount() === 0) this.stopTick()
  }

  private ensureTickRunning() {
    if (this.tickHandle !== null) return
    this.tickHandle = setInterval(() => this.broadcastState(), TICK_MS)
  }

  private stopTick() {
    if (this.tickHandle === null) return
    clearInterval(this.tickHandle)
    this.tickHandle = null
  }

  private connectionCount(): number {
    let n = 0
    for (const _ of this.getConnections()) n++
    return n
  }

  private players(): LobbyPlayer[] {
    const out: LobbyPlayer[] = []
    for (const c of this.getConnections<PlayerState>()) {
      if (c.state) out.push(playerView(c.state))
    }
    return out
  }

  private broadcastState() {
    if (this.connectionCount() === 0) {
      this.stopTick()
      return
    }
    const players = this.players()
    this.stepBoss(players)
    const msg: LobbyServerMessage = {
      type: 'state',
      tick: ++this.tick,
      serverNow: Date.now(),
      players,
      entities: this.entities.size > 0 ? [...this.entities.values()] : undefined,
      leaderId: this.leaderId(players),
    }
    this.broadcast(JSON.stringify(msg))
  }

  private leaderId(players: LobbyPlayer[]): string | undefined {
    let best: LobbyPlayer | undefined
    for (const p of players) {
      if ((p.lap ?? 0) <= 0) continue
      if (!best || (p.lap ?? 0) > (best.lap ?? 0)) best = p
    }
    return best?.id
  }

  private stepBoss(players: LobbyPlayer[]): void {
    if (this.entities.size === 0 || players.length === 0) return
    const BOSS_SPEED = 6 * TICK_MS / 1000
    let changed = false
    for (const boss of this.entities.values()) {
      if (boss.kind !== 'boss') continue
      let target: LobbyPlayer | undefined
      let bestDist = Infinity
      for (const p of players) {
        const d = (p.x - boss.x) ** 2 + (p.z - boss.z) ** 2
        if (d < bestDist) {
          bestDist = d
          target = p
        }
      }
      if (!target) continue
      const dx = target.x - boss.x
      const dz = target.z - boss.z
      const len = Math.hypot(dx, dz)
      if (len > 0.5) {
        boss.x += (dx / len) * BOSS_SPEED
        boss.z += (dz / len) * BOSS_SPEED
        boss.ry = Math.atan2(dx, dz)
        changed = true
      }
      if (len <= BOSS_TOUCH_RANGE) this.bossTouch(boss.id)
    }
    if (changed) void this.persistEntities()
  }

  private bossTouch(bossId: string): void {
    const now = Date.now()
    const last = this.lastBossHit.get(bossId) ?? 0
    if (now - last < 500) return
    this.lastBossHit.set(bossId, now)
    const boss = this.entities.get(bossId)
    if (!boss) return
    for (const c of this.getConnections<PlayerState>()) {
      const t = c.state
      if (!t || (t.hp ?? 0) <= 0) continue
      const d = Math.hypot(t.x - boss.x, t.z - boss.z)
      if (d > BOSS_TOUCH_RANGE) continue
      const hp = (t.hp ?? PLAYER_MAX_HP) - BOSS_TOUCH_DAMAGE
      if (hp <= 0) c.setState({ ...t, hp: PLAYER_MAX_HP, x: 0, z: 0, seenAt: now })
      else c.setState({ ...t, hp, seenAt: now })
    }
  }

  private broadcastSnapshot() {
    const msg: LobbyServerMessage = { type: 'snapshot', players: this.players() }
    this.broadcast(JSON.stringify(msg))
  }

  private sendTo(connection: Connection, message: LobbyServerMessage) {
    connection.send(JSON.stringify(message))
  }
}

function playerView(p: PlayerState): LobbyPlayer {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    ry: p.ry,
    lap: p.lap,
    lastLapMs: p.lastLapMs,
    seenAt: p.seenAt,
    hp: p.hp,
    kills: p.kills,
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.1, Math.min(20, value))
}
