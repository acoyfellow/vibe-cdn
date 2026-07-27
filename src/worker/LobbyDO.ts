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

type PlayerState = LobbyPlayer & { lastSeq: number }

export class LobbyDO extends Agent<Env> {
  static options = { hibernate: true }

  private tick = 0
  private tickHandle: ReturnType<typeof setInterval> | null = null
  private entities = new Map<string, ArenaEntity>()
  private entitiesLoaded = false

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
    }
    this.entities.set(id, entity)
    await this.persistEntities()
    this.ensureTickRunning()
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
    }
    if (changed) void this.persistEntities()
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
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.1, Math.min(20, value))
}
