// Multiplayer lobby + race room Durable Object.
//
// Two protocol rules that matter at 10+ players:
//   1. Inputs (move/lap/ping) arrive 10–20 Hz per client. We do NOT broadcast
//      on every incoming message. We update local session state and let the
//      fixed-rate tick fan out a coalesced `state` message.
//   2. The tick runs at 20 Hz via setInterval, started on first connect and
//      stopped when the room empties.
//
// Back-compat: we still emit `snapshot` messages (the legacy contract) on
// connect / disconnect / join. The existing lobby panel only reads
// `snapshot`/`pong`/`hello`; it's unaffected by the tick stream of `state`.

import type {
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
} from '../shared/contracts'

const TICK_HZ = 20
const TICK_MS = 1000 / TICK_HZ

export class LobbyDO {
  private sessions = new Map<WebSocket, InternalPlayer>()
  private tick = 0
  private tickHandle: ReturnType<typeof setInterval> | null = null

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const id = crypto.randomUUID().slice(0, 8)
    const player: InternalPlayer = {
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
    this.sessions.set(server, player)
    send(server, {
      type: 'hello',
      id,
      tickRate: TICK_HZ,
      serverNow: Date.now(),
    })
    // One legacy snapshot so the existing lobby panel paints immediately.
    this.broadcastSnapshot()

    this.ensureTickRunning()

    server.addEventListener('message', (event) => {
      this.handleMessage(server, String(event.data))
    })
    server.addEventListener('close', () => this.dropSession(server))
    server.addEventListener('error', () => this.dropSession(server))

    return new Response(null, { status: 101, webSocket: client })
  }

  private handleMessage(socket: WebSocket, text: string) {
    const player = this.sessions.get(socket)
    if (!player) return

    let message: LobbyClientMessage
    try {
      message = JSON.parse(text) as LobbyClientMessage
    } catch {
      send(socket, { type: 'error', message: 'invalid json' })
      return
    }

    switch (message.type) {
      case 'join': {
        player.name = String(message.name || player.name).slice(0, 24)
        player.seenAt = Date.now()
        this.broadcastSnapshot()
        return
      }
      case 'move': {
        const seq = typeof message.seq === 'number' ? message.seq : 0
        if (seq !== 0 && seq <= player.lastSeq) return // drop reorders
        player.lastSeq = seq
        player.x = finite(message.x)
        player.y = finite(message.y)
        player.z = finite(message.z)
        if (typeof message.ry === 'number') player.ry = finite(message.ry)
        player.seenAt = Date.now()
        // No broadcast — the tick will fan out.
        return
      }
      case 'lap': {
        player.lap = Math.max(0, Math.floor(message.lap))
        if (typeof message.lastLapMs === 'number') player.lastLapMs = Math.floor(message.lastLapMs)
        player.seenAt = Date.now()
        // No broadcast — tick handles it.
        return
      }
      case 'ping': {
        send(socket, { type: 'pong', t: message.t, now: Date.now() })
        return
      }
    }
  }

  private dropSession(socket: WebSocket) {
    if (!this.sessions.delete(socket)) return
    this.broadcastSnapshot()
    if (this.sessions.size === 0) this.stopTick()
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

  private broadcastState() {
    if (this.sessions.size === 0) {
      this.stopTick()
      return
    }
    const players = Array.from(this.sessions.values()).map(playerView)
    const msg: LobbyServerMessage = {
      type: 'state',
      tick: ++this.tick,
      serverNow: Date.now(),
      players,
    }
    const text = JSON.stringify(msg)
    for (const sock of this.sessions.keys()) sock.send(text)
  }

  private broadcastSnapshot() {
    const players = Array.from(this.sessions.values()).map(playerView)
    for (const sock of this.sessions.keys()) {
      send(sock, { type: 'snapshot', players })
    }
  }
}

type InternalPlayer = LobbyPlayer & { lastSeq: number }

function playerView(p: InternalPlayer): LobbyPlayer {
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

function send(socket: WebSocket, message: LobbyServerMessage) {
  socket.send(JSON.stringify(message))
}
