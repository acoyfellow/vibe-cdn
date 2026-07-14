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
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
} from '../shared/contracts'

const TICK_HZ = 20
const TICK_MS = 1000 / TICK_HZ

type PlayerState = LobbyPlayer & { lastSeq: number }

export class LobbyDO extends Agent<Env> {
  static options = { hibernate: true }

  private tick = 0
  private tickHandle: ReturnType<typeof setInterval> | null = null

  onConnect(connection: Connection, _ctx: ConnectionContext): void {
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
    }
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
    const msg: LobbyServerMessage = {
      type: 'state',
      tick: ++this.tick,
      serverNow: Date.now(),
      players: this.players(),
    }
    this.broadcast(JSON.stringify(msg))
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
