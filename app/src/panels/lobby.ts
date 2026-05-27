import type { LobbyClientMessage, LobbyServerMessage, LobbyPlayer } from '../../../src/shared/contracts'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const LOBBY_PATH = '/ws/lobby/local'

export function lobbyPanel(): HTMLElement {
  const status = makeStatus('idle', 'disconnected')
  const log = el('div', { class: 'log' })
  const playerList = el('ul', { class: 'player-list' })
  const pingOut = el('span', { class: 'kv-val', text: '— ms' })

  const nameInput = el('input', {
    class: 'text-input',
    attrs: { type: 'text', maxlength: '24', value: 'kiddo' },
  })

  let ws: WebSocket | null = null
  let pingTimer: number | null = null
  let moveTimer: number | null = null
  let me: string | null = null

  const send = (msg: LobbyClientMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const renderPlayers = (players: LobbyPlayer[]) => {
    playerList.innerHTML = ''
    if (players.length === 0) {
      playerList.appendChild(el('li', { class: 'empty', text: 'no players yet' }))
      return
    }
    for (const p of players) {
      const isMe = p.id === me
      playerList.appendChild(
        el('li', {
          class: isMe ? 'player-row me' : 'player-row',
          children: [
            el('span', { class: 'player-name', text: isMe ? `${p.name} (you)` : p.name }),
            el('span', {
              class: 'player-pos',
              text: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
            }),
          ],
        }),
      )
    }
  }

  const disconnect = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (moveTimer !== null) {
      clearInterval(moveTimer)
      moveTimer = null
    }
    if (ws) {
      try {
        ws.close()
      } catch {
        // ignore
      }
      ws = null
    }
    me = null
    setStatus(status, 'idle', 'disconnected')
    renderPlayers([])
  }

  const connect = () => {
    disconnect()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}${LOBBY_PATH}`
    setStatus(status, 'busy', 'connecting…')
    logLine(log, `connecting to ${url}`, 'info')
    let sock: WebSocket
    try {
      sock = new WebSocket(url)
    } catch (err) {
      setStatus(status, 'fail', 'open failed')
      logLine(log, `connect threw: ${(err as Error).message}`, 'fail')
      return
    }
    ws = sock

    sock.addEventListener('open', () => {
      setStatus(status, 'ok', 'connected')
      logLine(log, `connected`, 'ok')
      const name = nameInput.value.trim() || 'player'
      send({ type: 'join', name })
      pingTimer = window.setInterval(() => send({ type: 'ping', t: Date.now() }), 2000)
      moveTimer = window.setInterval(() => {
        const t = Date.now() / 1000
        send({
          type: 'move',
          x: Math.cos(t) * 3,
          y: 0,
          z: Math.sin(t) * 3,
        })
      }, 500)
    })

    sock.addEventListener('message', (ev) => {
      let msg: LobbyServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as LobbyServerMessage
      } catch {
        logLine(log, `bad message: ${String(ev.data).slice(0, 60)}`, 'fail')
        return
      }
      if (msg.type === 'hello') {
        me = msg.id
        logLine(log, `hello — you are ${msg.id.slice(0, 8)}`, 'ok')
      } else if (msg.type === 'snapshot') {
        renderPlayers(msg.players)
      } else if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t
        pingOut.textContent = `${rtt} ms`
      } else if (msg.type === 'error') {
        logLine(log, `server error: ${msg.message}`, 'fail')
      }
    })

    sock.addEventListener('close', () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      if (moveTimer !== null) {
        clearInterval(moveTimer)
        moveTimer = null
      }
      setStatus(status, 'idle', 'disconnected')
      logLine(log, `socket closed`, 'info')
    })

    sock.addEventListener('error', () => {
      setStatus(status, 'fail', 'error')
      logLine(log, `socket error`, 'fail')
    })
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', {
        class: 'row',
        children: [
          el('label', { class: 'field', children: [el('span', { text: 'name' }), nameInput] }),
          bigButton('Connect', connect),
          bigButton('Disconnect', disconnect),
          status,
        ],
      }),
      el('div', {
        class: 'kv-row',
        children: [el('span', { class: 'kv-key', text: 'ping' }), pingOut],
      }),
      playerList,
      log,
    ],
  })

  return panel('4. Lobby (Durable Object)', `Connects to ${LOBBY_PATH} over WebSocket. Open another tab to see two players.`, body)
}
