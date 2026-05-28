// Mini Race — the unifying demo.
//
// One panel that exercises: R2 (the Ferrari GLB), Workers (the CDN),
// Durable Objects (the lobby), D1 (lap times), and the live page (every
// visitor sees every other visitor as a ghost car).
//
// Per the dossier in docs/_mini-race-notes.md:
//   - WASD car heading + throttle, chase camera (no PointerLockControls).
//   - Procedural CatmullRomCurve3 ribbon track in the XZ plane.
//   - Start-line crossing with direction check + halfway checkpoint.
//   - 20 Hz `move` send rate, snapshot interpolation at 150ms delay.
//   - Server tick rate is also 20 Hz; we read the `state` messages.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type {
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
} from '../../../src/shared/contracts'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const CAR_ASSET = '/assets/demo/car.glb'
const LOBBY_PATH = '/ws/lobby/race'
const SEND_HZ = 20
const SEND_MS = 1000 / SEND_HZ
const INTERP_DELAY_MS = 150
const MAX_SPEED = 24
const ACCEL = 14
const REVERSE_ACCEL = 8
const TURN_RATE = 1.8
const DRAG = 0.8

export function racePanel(): HTMLElement {
  const status = makeStatus('idle', 'load car to start')
  const log = el('div', { class: 'log' })
  const stage = el('div', { class: 'gltf-stage race-stage' })

  // HUD overlay
  const hudSpeed = el('span', { class: 'hud-val mono', text: '0' })
  const hudLap = el('span', { class: 'hud-val mono', text: '0' })
  const hudBestLap = el('span', { class: 'hud-val mono', text: '—' })
  const hudPlayers = el('span', { class: 'hud-val mono', text: '0' })
  const hudPing = el('span', { class: 'hud-val mono', text: '— ms' })
  const hud = el('div', {
    class: 'race-hud',
    children: [
      hudCell('speed', hudSpeed, 'mph-ish'),
      hudCell('lap', hudLap, ''),
      hudCell('best', hudBestLap, 'seconds'),
      hudCell('players', hudPlayers, 'online'),
      hudCell('ping', hudPing, ''),
    ],
  })
  stage.appendChild(hud)

  const nameInput = el('input', {
    class: 'text-input',
    attrs: { type: 'text', maxlength: '24', value: 'kiddo' },
  })

  // ── Three.js scene ────────────────────────────────────────────────────
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 800)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 1)
  stage.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xffffff, 0.3))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(50, 80, 30)
  scene.add(sun as unknown as object)
  const fill = new THREE.DirectionalLight(0x99ccff, 0.45)
  fill.position.set(-30, 50, -20)
  scene.add(fill as unknown as object)

  // Track
  const { mesh: trackMesh, curve, startLine, halfway } = buildTrack()
  scene.add(trackMesh as unknown as object)

  // Start-line strip (visual)
  scene.add(buildLineMarker(startLine.a, startLine.b, 0xffe000) as unknown as object)

  // The player's car (filled in after GLB loads)
  const carGroup = new THREE.Group()
  curve.getPointAt(0.001, carGroup.position as unknown as THREE.Vector3)
  // face along the curve's forward direction
  const startTangent = new THREE.Vector3()
  curve.getTangentAt(0.001, startTangent)
  carGroup.rotation.y = Math.atan2(startTangent.x, startTangent.z)
  scene.add(carGroup as unknown as object)

  // Ghost cars: rendered placeholders + snapshot buffers per remote id.
  const ghosts = new Map<string, Ghost>()
  let carTemplate: THREE.Object3D | null = null

  // ── State ─────────────────────────────────────────────────────────────
  const keys = { w: false, a: false, s: false, d: false }
  let speed = 0
  let lap = 0
  let bestLapMs: number | null = null
  let lapStartedAt = performance.now()
  let passedHalf = false
  let myId: string | null = null
  let socket: WebSocket | null = null
  let seq = 0
  let lastSentAt = 0
  let lastPing = NaN
  let pingTimer: number | null = null
  let raf = 0
  let lastFrameAt = performance.now()
  const prevCarPos = new THREE.Vector3()
  const motionVec = new THREE.Vector3()
  const carForward = new THREE.Vector3()
  const camOffset = new THREE.Vector3(0, 4.0, -8.0)
  const camTmp = new THREE.Vector3()
  const lookTmp = new THREE.Vector3()

  // ── Loading ───────────────────────────────────────────────────────────
  const loadCar = async () => {
    setStatus(status, 'busy', 'loading car…')
    const loader = new GLTFLoader()
    // The Ferrari uses Draco-compressed geometry. Decoder served from
    // Google's CDN keeps the demo zero-config.
    const draco = new DRACOLoader()
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    loader.setDRACOLoader(draco)
    const t0 = performance.now()
    loader.load(
      CAR_ASSET,
      (gltf) => {
        const root = gltf.scene
        // Normalize: scale so the car is ~3 units long, oriented to face +Z.
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const s = 3 / maxDim
        root.scale.set(s, s, s)
        root.position.set(0, 0, 0)

        carTemplate = root
        // Mount a clone as the player's car
        const playerCar = (root as unknown as { clone: (deep?: boolean) => THREE.Object3D }).clone(true)
        ;(carGroup as unknown as { add(child: unknown): void }).add(playerCar)
        prevCarPos.copy(carGroup.position as unknown as THREE.Vector3)

        const ms = Math.round(performance.now() - t0)
        logLine(log, `loaded ${CAR_ASSET} in ${ms} ms`, 'ok')
        setStatus(status, 'ok', `ready — WASD to drive`)
        connect()
      },
      undefined,
      (err: unknown) => {
        setStatus(status, 'fail', 'load failed')
        const msg = err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: unknown }).message)
          : String(err)
        logLine(log, `GLTFLoader: ${msg}`, 'fail')
      },
    )
  }

  // ── WebSocket lobby ───────────────────────────────────────────────────
  const connect = () => {
    disconnect()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}${LOBBY_PATH}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      logLine(log, `socket open failed: ${(err as Error).message}`, 'fail')
      return
    }
    socket = ws

    ws.addEventListener('open', () => {
      const name = nameInput.value.trim() || 'racer'
      send({ type: 'join', name })
      pingTimer = window.setInterval(() => send({ type: 'ping', t: Date.now() }), 1000)
      logLine(log, `lobby connected`, 'ok')
    })

    ws.addEventListener('message', (ev) => {
      let msg: LobbyServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as LobbyServerMessage
      } catch {
        return
      }
      if (msg.type === 'hello') {
        myId = msg.id
      } else if (msg.type === 'state' || msg.type === 'snapshot') {
        ingestPlayers(msg.players)
      } else if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t
        lastPing = rtt
        hudPing.textContent = `${rtt} ms`
      }
    })

    ws.addEventListener('close', () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      logLine(log, `lobby closed`, 'info')
    })
    ws.addEventListener('error', () => logLine(log, `socket error`, 'fail'))
  }

  const disconnect = () => {
    if (pingTimer !== null) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (socket) {
      try {
        socket.close()
      } catch {
        // ignore
      }
      socket = null
    }
    for (const [, g] of ghosts) {
      ;(scene as unknown as { remove(child: unknown): void }).remove(g.mesh)
    }
    ghosts.clear()
    hudPlayers.textContent = '0'
  }

  const send = (msg: LobbyClientMessage) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  const ingestPlayers = (players: LobbyPlayer[]) => {
    const tNow = performance.now()
    const seen = new Set<string>()
    for (const p of players) {
      if (p.id === myId) continue
      seen.add(p.id)
      let ghost = ghosts.get(p.id)
      if (!ghost) {
        if (!carTemplate) continue
        const mesh = (carTemplate as unknown as { clone: (deep?: boolean) => THREE.Object3D }).clone(true)
        // tint ghosts faintly so they're distinguishable (just position offset)
        ;(scene as unknown as { add(child: unknown): void }).add(mesh)
        ghost = { mesh, buffer: [], lap: p.lap ?? 0 }
        ghosts.set(p.id, ghost)
      }
      ghost.lap = p.lap ?? 0
      ghost.buffer.push({ t: tNow, x: p.x, y: p.y, z: p.z, ry: p.ry })
      const cutoff = tNow - INTERP_DELAY_MS * 4
      while (ghost.buffer.length > 2 && (ghost.buffer[1]?.t ?? 0) < cutoff) ghost.buffer.shift()
    }
    for (const [id, ghost] of ghosts) {
      if (!seen.has(id)) {
        ;(scene as unknown as { remove(child: unknown): void }).remove(ghost.mesh)
        ghosts.delete(id)
      }
    }
    hudPlayers.textContent = String(players.length)
  }

  // ── Input ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (!stage.matches(':hover') && document.activeElement !== stage) return
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.w = true
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.s = true
    else if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.a = true
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.d = true
    else return
    e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.w = false
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.s = false
    else if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.a = false
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.d = false
  }
  window.addEventListener('keydown', onKeyDown, { passive: false })
  window.addEventListener('keyup', onKeyUp)

  // ── Render loop ───────────────────────────────────────────────────────
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrameAt) / 1000)
    lastFrameAt = now
    updateCar(dt)
    checkLap()
    updateCamera()
    interpolateGhosts(now)
    maybeSendMove(now)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  const updateCar = (dt: number) => {
    if (keys.w) speed += ACCEL * dt
    if (keys.s) speed -= REVERSE_ACCEL * dt
    // Drag — strong when no input, light when accelerating.
    const drag = (keys.w || keys.s) ? DRAG * 0.2 : DRAG
    if (Math.abs(speed) > 0.01) speed -= Math.sign(speed) * drag * dt * Math.abs(speed)
    speed = Math.max(-MAX_SPEED * 0.5, Math.min(MAX_SPEED, speed))

    const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0)
    // Only turn when moving.
    if (Math.abs(speed) > 0.05) {
      carGroup.rotation.y += steer * TURN_RATE * dt * (speed / MAX_SPEED)
    }
    // forward = local -Z rotated by yaw
    carForward.set(Math.sin(carGroup.rotation.y), 0, Math.cos(carGroup.rotation.y))
    ;(carGroup.position as unknown as { x: number; z: number }).x += carForward.x * speed * dt
    ;(carGroup.position as unknown as { x: number; z: number }).z += carForward.z * speed * dt

    // HUD
    hudSpeed.textContent = String(Math.round(Math.abs(speed) * 2.2))
    hudLap.textContent = String(lap)
  }

  const checkLap = () => {
    motionVec.subVectors(carGroup.position as unknown as THREE.Vector3, prevCarPos)
    if (motionVec.lengthSq() > 1e-6) {
      // Halfway gate
      if (!passedHalf && segmentsCrossXZ(prevCarPos, carGroup.position as unknown as THREE.Vector3, halfway.a, halfway.b)) {
        passedHalf = true
      }
      // Start/finish line crossing — only counts if we've cleared halfway AND moving in track-forward direction.
      const aligned = motionVec.dot(startLine.forward) > 0
      if (passedHalf && aligned && segmentsCrossXZ(prevCarPos, carGroup.position as unknown as THREE.Vector3, startLine.a, startLine.b)) {
        const now = performance.now()
        const lapMs = Math.round(now - lapStartedAt)
        lap++
        passedHalf = false
        lapStartedAt = now
        if (bestLapMs === null || lapMs < bestLapMs) {
          bestLapMs = lapMs
          hudBestLap.textContent = (lapMs / 1000).toFixed(2)
        }
        send({ type: 'lap', lap, lastLapMs: lapMs })
        logLine(log, `lap ${lap} — ${(lapMs / 1000).toFixed(2)}s`, 'ok')
      }
    }
    prevCarPos.copy(carGroup.position as unknown as THREE.Vector3)
  }

  const updateCamera = () => {
    camTmp.copy(camOffset).applyQuaternion(carGroup.quaternion as unknown as THREE.Quaternion)
    camTmp.add(carGroup.position as unknown as THREE.Vector3)
    camera.position.lerp(camTmp, 0.18)
    lookTmp.copy(carGroup.position as unknown as THREE.Vector3)
    lookTmp.y += 0.8
    camera.lookAt(lookTmp.x, lookTmp.y, lookTmp.z)
  }

  const ghostTmp = new THREE.Vector3()
  const interpolateGhosts = (now: number) => {
    const renderTime = now - INTERP_DELAY_MS
    for (const [, ghost] of ghosts) {
      if (ghost.buffer.length === 0) continue
      const yaw = sampleAt(ghost.buffer, renderTime, ghostTmp)
      if (yaw === null) continue
      ;(ghost.mesh.position as unknown as { x: number; y: number; z: number }).x = ghostTmp.x
      ;(ghost.mesh.position as unknown as { x: number; y: number; z: number }).y = ghostTmp.y
      ;(ghost.mesh.position as unknown as { x: number; y: number; z: number }).z = ghostTmp.z
      ;(ghost.mesh.rotation as unknown as { y: number }).y = yaw
    }
  }

  const maybeSendMove = (now: number) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (now - lastSentAt < SEND_MS) return
    lastSentAt = now
    seq++
    send({
      type: 'move',
      x: (carGroup.position as unknown as { x: number }).x,
      y: (carGroup.position as unknown as { y: number }).y,
      z: (carGroup.position as unknown as { z: number }).z,
      ry: carGroup.rotation.y,
      seq,
      t: now,
    })
  }

  // ── Wire up DOM ───────────────────────────────────────────────────────
  const resize = () => {
    const w = stage.clientWidth || 480
    const h = Math.round(w * (9 / 16))
    renderer.setSize(w, h, true)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const controlsRow = el('div', {
    class: 'row',
    children: [
      el('label', { class: 'field', children: [el('span', { text: 'name' }), nameInput] }),
      bigButton('Load + Race', loadCar),
      bigButton('Reset', () => {
        speed = 0
        lap = 0
        passedHalf = false
        bestLapMs = null
        hudBestLap.textContent = '—'
        curve.getPointAt(0.001, carGroup.position as unknown as THREE.Vector3)
        const t = new THREE.Vector3()
        curve.getTangentAt(0.001, t)
        carGroup.rotation.y = Math.atan2(t.x, t.z)
        lapStartedAt = performance.now()
        prevCarPos.copy(carGroup.position as unknown as THREE.Vector3)
      }),
      status,
    ],
  })

  const body = el('div', {
    class: 'panel-body',
    children: [
      controlsRow,
      stage,
      el('p', {
        class: 'help',
        text: 'click the stage to focus, then WASD or arrows. Open a second tab to see a ghost of yourself.',
      }),
      log,
    ],
  })

  // Boot
  queueMicrotask(() => {
    resize()
    window.addEventListener('resize', resize)
    stage.setAttribute('tabindex', '0')
    stage.addEventListener('click', () => stage.focus())
    raf = requestAnimationFrame(tick)
  })

  // Best-effort cleanup
  const observer = new MutationObserver(() => {
    if (!document.body.contains(body)) {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      disconnect()
      renderer.dispose()
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  void lastPing // keep referenced to avoid unused-var noise (we read it via hudPing)

  return panel(
    '2. Mini Race (multiplayer, ghost cars, lap timer)',
    'The Ferrari from R2, on a procedurally-generated track, with WASD controls. Every visitor in the same room sees every other visitor as a ghost car, synced through a Durable Object at 20 Hz with snapshot interpolation. Lap times computed client-side with halfway-checkpoint anti-cheat.',
    body,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

type Snapshot = { t: number; x: number; y: number; z: number; ry: number }
type Ghost = { mesh: THREE.Object3D; buffer: Snapshot[]; lap: number }

function hudCell(label: string, valueEl: HTMLElement, sub: string): HTMLElement {
  return el('div', {
    class: 'hud-cell',
    children: [
      el('span', { class: 'hud-lbl', text: label }),
      valueEl,
      sub ? el('span', { class: 'hud-sub', text: sub }) : null,
    ],
  })
}

function buildTrack(): {
  mesh: THREE.Mesh
  curve: THREE.CatmullRomCurve3
  startLine: { a: THREE.Vector3; b: THREE.Vector3; forward: THREE.Vector3 }
  halfway: { a: THREE.Vector3; b: THREE.Vector3 }
} {
  const TRACK_WIDTH = 12
  const SEGMENTS = 256

  // Closed loop in the XZ plane. Reasonable kart-track shape.
  const points = [
    new THREE.Vector3(60, 0, 0),
    new THREE.Vector3(40, 0, 40),
    new THREE.Vector3(0, 0, 55),
    new THREE.Vector3(-40, 0, 45),
    new THREE.Vector3(-60, 0, 10),
    new THREE.Vector3(-50, 0, -30),
    new THREE.Vector3(-10, 0, -55),
    new THREE.Vector3(30, 0, -45),
    new THREE.Vector3(55, 0, -20),
  ]
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)

  const positions = new Float32Array((SEGMENTS + 1) * 2 * 3)
  const uvs = new Float32Array((SEGMENTS + 1) * 2 * 2)
  const up = new THREE.Vector3(0, 1, 0)
  const tmpT = new THREE.Vector3()
  const tmpN = new THREE.Vector3()
  const tmpP = new THREE.Vector3()
  const halfW = TRACK_WIDTH / 2

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    curve.getPointAt(t, tmpP)
    curve.getTangentAt(t, tmpT)
    tmpN.crossVectors(tmpT, up).normalize().multiplyScalar(halfW)
    const o = i * 6
    positions[o + 0] = tmpP.x - tmpN.x
    positions[o + 1] = 0
    positions[o + 2] = tmpP.z - tmpN.z
    positions[o + 3] = tmpP.x + tmpN.x
    positions[o + 4] = 0
    positions[o + 5] = tmpP.z + tmpN.z
    const u = i * 4
    uvs[u + 0] = 0
    uvs[u + 1] = (t * SEGMENTS) / 4
    uvs[u + 2] = 1
    uvs[u + 3] = (t * SEGMENTS) / 4
  }

  const indices: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = i * 2 + 2
    const d = i * 2 + 3
    indices.push(a, b, d, a, d, c)
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geom.setIndex(indices)
  geom.computeVertexNormals()

  // Asphalt + yellow centerline procedural texture.
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 512
  const g = canvas.getContext('2d')!
  g.fillStyle = '#1c1c1c'
  g.fillRect(0, 0, 64, 512)
  g.fillStyle = '#ffe000'
  for (let y = 0; y < 512; y += 64) g.fillRect(30, y, 4, 32)
  // edge stripes
  g.fillStyle = '#ffffff'
  g.fillRect(2, 0, 2, 512)
  g.fillRect(60, 0, 2, 512)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 })
  ;(mat as unknown as { map: unknown }).map = tex
  const mesh = new THREE.Mesh(geom, mat)

  // Start line and halfway gate as line segments perpendicular to the tangent.
  const startA = new THREE.Vector3()
  const startB = new THREE.Vector3()
  const startTan = new THREE.Vector3()
  const startN = new THREE.Vector3()
  curve.getPointAt(0, startA)
  curve.getTangentAt(0, startTan)
  startN.crossVectors(startTan, up).normalize().multiplyScalar(halfW)
  const startCenter = startA.clone()
  startA.copy(startCenter).sub(startN)
  startB.copy(startCenter).add(startN)

  const halfA = new THREE.Vector3()
  const halfB = new THREE.Vector3()
  const halfTan = new THREE.Vector3()
  const halfN = new THREE.Vector3()
  curve.getPointAt(0.5, halfA)
  curve.getTangentAt(0.5, halfTan)
  halfN.crossVectors(halfTan, up).normalize().multiplyScalar(halfW)
  const halfCenter = halfA.clone()
  halfA.copy(halfCenter).sub(halfN)
  halfB.copy(halfCenter).add(halfN)

  return {
    mesh,
    curve,
    startLine: { a: startA, b: startB, forward: startTan.clone().normalize() },
    halfway: { a: halfA, b: halfB },
  }
}

function buildLineMarker(a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Mesh {
  // A thin horizontal strip on the ground showing the start line.
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz)
  const cx = (a.x + b.x) / 2
  const cz = (a.z + b.z) / 2
  const angle = Math.atan2(dz, dx)
  const geom = new THREE.PlaneGeometry(len, 1.4)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
  const mesh = new THREE.Mesh(geom, mat)
  ;(mesh.position as unknown as { x: number; y: number; z: number }).x = cx
  ;(mesh.position as unknown as { x: number; y: number; z: number }).y = 0.02
  ;(mesh.position as unknown as { x: number; y: number; z: number }).z = cz
  mesh.rotation.x = -Math.PI / 2
  mesh.rotation.z = -angle
  return mesh
}

function segmentsCrossXZ(p1: THREE.Vector3, p2: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): boolean {
  const d = (b.x - a.x) * (p2.z - p1.z) - (b.z - a.z) * (p2.x - p1.x)
  if (Math.abs(d) < 1e-9) return false
  const s = ((p2.z - p1.z) * (b.x - p1.x) - (p2.x - p1.x) * (b.z - p1.z)) / d
  const t = ((b.z - a.z) * (b.x - p1.x) - (b.x - a.x) * (b.z - p1.z)) / d
  return s >= 0 && s <= 1 && t >= 0 && t <= 1
}

function sampleAt(buf: Snapshot[], renderTime: number, out: THREE.Vector3): number | null {
  if (buf.length === 0) return null
  if (buf.length === 1 || renderTime <= (buf[0]?.t ?? 0)) {
    const s = buf[0]!
    out.set(s.x, s.y, s.z)
    return s.ry
  }
  const last = buf[buf.length - 1]!
  if (renderTime >= last.t) {
    out.set(last.x, last.y, last.z)
    return last.ry
  }
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i]!
    const b = buf[i + 1]!
    if (renderTime >= a.t && renderTime <= b.t) {
      const u = (renderTime - a.t) / (b.t - a.t)
      out.set(
        a.x + (b.x - a.x) * u,
        a.y + (b.y - a.y) * u,
        a.z + (b.z - a.z) * u,
      )
      let dy = b.ry - a.ry
      if (dy > Math.PI) dy -= Math.PI * 2
      if (dy < -Math.PI) dy += Math.PI * 2
      return a.ry + dy * u
    }
  }
  return last.ry
}
