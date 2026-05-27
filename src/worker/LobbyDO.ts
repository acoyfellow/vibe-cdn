import type { LobbyClientMessage, LobbyPlayer, LobbyServerMessage } from '../shared/contracts'

export class LobbyDO {
  private sessions = new Map<WebSocket, LobbyPlayer>()

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const id = crypto.randomUUID().slice(0, 8)
    const player: LobbyPlayer = { id, name: `player-${id}`, x: 0, y: 0, z: 0, seenAt: Date.now() }
    this.sessions.set(server, player)
    send(server, { type: 'hello', id })
    this.broadcast()

    server.addEventListener('message', (event) => {
      this.handleMessage(server, String(event.data))
    })
    server.addEventListener('close', () => {
      this.sessions.delete(server)
      this.broadcast()
    })
    server.addEventListener('error', () => {
      this.sessions.delete(server)
      this.broadcast()
    })

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

    if (message.type === 'join') {
      player.name = String(message.name || player.name).slice(0, 24)
      player.seenAt = Date.now()
      this.broadcast()
      return
    }

    if (message.type === 'move') {
      player.x = finite(message.x)
      player.y = finite(message.y)
      player.z = finite(message.z)
      player.seenAt = Date.now()
      this.broadcast()
      return
    }

    if (message.type === 'ping') {
      send(socket, { type: 'pong', t: message.t, now: Date.now() })
    }
  }

  private broadcast() {
    const players = Array.from(this.sessions.values())
    for (const socket of this.sessions.keys()) send(socket, { type: 'snapshot', players })
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function send(socket: WebSocket, message: LobbyServerMessage) {
  socket.send(JSON.stringify(message))
}
