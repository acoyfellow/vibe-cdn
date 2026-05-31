// Mini Arena — the unifying demo.
//
// Open arena instead of a forced ring track. Drop the Ferrari onto a wide
// gridded plane and drive freely with WASD. Every visitor to this URL
// shares the same Durable Object room and sees the others as ghost cars
// synced at 20 Hz with snapshot interpolation.
//
// Until the visitor takes the wheel, the car sits parked while the camera
// slowly orbits it (showroom turntable) — alive, but not wandering off.
// Press any movement key and you take over. Top speed achieved this
// session is the leaderboard score.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type {
  LobbyClientMessage,
  LobbyPlayer,
  LobbyServerMessage,
} from '../../../src/shared/contracts'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'
import { playgroundConfig } from '../playground/config'
import { createTerrain } from '../playground/terrain'
import { createObjects, collideObjects, resetObjects, updateObjects } from '../playground/objects'
import { ShootingSystem } from '../playground/shooting'

const CAR_ASSET = '/cdn/demo/car.glb'
const LOBBY_PATH = '/ws/lobby/arena'
const SEND_HZ = 20
const SEND_MS = 1000 / SEND_HZ
// Remote ghost cars buffer one clean 20 Hz tick (50ms), then expand only
// when measured packet-arrival jitter requires it. The old fixed 150ms
// buffer added avoidable visible latency even on clean connections.
const MIN_INTERP_MS = SEND_MS
const MAX_INTERP_MS = 130
const ARENA_HALF = playgroundConfig.terrain.arenaHalf
const TOP_SPEED_POST_THRESHOLD = 2 // only post when top speed improves by 2 mph

export function racePanel(): HTMLElement {
  const status = makeStatus('busy', 'loading…')
  const log = el('div', { class: 'log' })
  const stage = el('div', { class: 'gltf-stage race-stage' })

  // HUD overlay (no lap timer — open arena)
  const hudSpeed = el('span', { class: 'hud-val mono', text: '0' })
  const hudTopSpeed = el('span', { class: 'hud-val mono', text: '0' })
  const hudPlayers = el('span', { class: 'hud-val mono', text: '0' })
  const hudShots = el('span', { class: 'hud-val mono', text: '0' })
  const hudRtt = el('span', { class: 'hud-val mono', text: '—' })
  const hudBuffer = el('span', { class: 'hud-val mono', text: String(MIN_INTERP_MS) })
  const hud = el('div', {
    class: 'race-hud',
    children: [
      hudCell('speed', hudSpeed, 'mph-ish'),
      hudCell('top speed', hudTopSpeed, 'this session'),
      hudCell('shots', hudShots, 'live'),
      hudCell('players', hudPlayers, 'online'),
      hudCell('RTT', hudRtt, 'ms'),
      hudCell('smooth', hudBuffer, 'ms'),
    ],
  })
  stage.appendChild(hud)

  // Mobile-first controls. The game cannot require a keyboard when kids are
  // opening it from a phone. The left thumb is an analog drive stick; the
  // right thumb gets fire/reset. These feed the same state as WASD/Space.
  const joystick = { x: 0, y: 0, active: false, pointerId: -1 }
  const joystickThumb = el('div', { class: 'joystick-thumb' })
  const joystickBase = el('div', {
    class: 'joystick-base',
    attrs: { role: 'application', 'aria-label': 'drive joystick' },
    children: [joystickThumb],
  })
  const touchFire = el('button', { class: 'touch-action touch-fire', text: 'FIRE', attrs: { type: 'button', 'aria-label': 'fire' } })
  const touchReset = el('button', { class: 'touch-action touch-reset', text: 'RESET', attrs: { type: 'button', 'aria-label': 'reset car' } })
  const touchControls = el('div', {
    class: 'touch-controls',
    children: [joystickBase, el('div', { class: 'touch-actions', children: [touchFire, touchReset] })],
  })
  stage.appendChild(touchControls)

  const nameInput = el('input', {
    class: 'text-input',
    attrs: { type: 'text', maxlength: '24', value: 'kiddo' },
  })

  // ── Three.js scene ───────────────────────────────────────────────
  const scene = new THREE.Scene()
  // Soft off-black so the floor fades into a horizon rather than
  // hard-edging on a pure black void.
  const HORIZON_COLOR = 0x0a0b10
  scene.background = new THREE.Color(HORIZON_COLOR)
  // Fog falls off at the edge of the arena so the gridded floor visually
  // dissolves into the horizon.
  scene.fog = new THREE.Fog(HORIZON_COLOR, ARENA_HALF * 0.55, ARENA_HALF * 1.4)

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 800)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(HORIZON_COLOR, 1)
  stage.appendChild(renderer.domElement)

  // Sky/ground hemisphere gives the floor an even ambient.
  scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x1a1a1a, 0.7) as unknown as object)
  scene.add(new THREE.AmbientLight(0xffffff, 0.25))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(60, 100, 40)
  scene.add(sun as unknown as object)
  const fill = new THREE.DirectionalLight(0x99ccff, 0.4)
  fill.position.set(-40, 60, -30)
  scene.add(fill as unknown as object)

  // Playground systems are config-first: a future overlay only mutates this data.
  const terrain = createTerrain(playgroundConfig)
  scene.add(terrain.mesh)
  const arenaObjects = createObjects(playgroundConfig, terrain)
  for (const object of arenaObjects) scene.add(object.mesh)
  const shooting = new ShootingSystem(scene, playgroundConfig, terrain)

  // A subtle origin marker so the arena has a visual anchor.
  scene.add(buildOriginMarker(terrain.heightAt(0, 0)) as unknown as object)

  // The player's car (filled in after GLB loads).
  const carGroup = new THREE.Group()
  carGroup.position.set(0, 0, 0)
  carGroup.rotation.y = 0
  scene.add(carGroup as unknown as object)

  // Ghost cars: rendered placeholders + snapshot buffers per remote id.
  const ghosts = new Map<string, Ghost>()
  let carTemplate: THREE.Object3D | null = null

  // ── State ─────────────────────────────────────────────────────────────
  const keys = { w: false, a: false, s: false, d: false, fire: false }
  let speed = 0
  let verticalVelocity = 0
  let airborne = false
  let topSpeed = 0
  let lastPostedTopSpeed = 0
  let myId: string | null = null
  let socket: WebSocket | null = null
  let seq = 0
  let lastSentAt = 0
  let rttEma = NaN
  let jitterEma = 0
  let lastStateArrival = 0
  let interpolationDelayMs = MIN_INTERP_MS
  let pingTimer: number | null = null
  let raf = 0
  let lastFrameAt = performance.now()
  let userHasDriven = false
  let idleStartedAt = performance.now()
  const carForward = new THREE.Vector3()
  const camOffset = new THREE.Vector3(0, 4.0, -8.0)
  const camTmp = new THREE.Vector3()
  const lookTmp = new THREE.Vector3()
  const ghostTmp = new THREE.Vector3()

  // ── Loading ───────────────────────────────────────────────────────────
  const loadCar = async () => {
    setStatus(status, 'busy', 'loading car…')
    const loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    loader.setDRACOLoader(draco)
    const t0 = performance.now()
    loader.load(
      CAR_ASSET,
      (gltf) => {
        const root = gltf.scene
        // Normalize: scale so the car is ~3 units long.
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const s = 3 / maxDim
        root.scale.set(s, s, s)
        root.position.set(0, 0, 0)

        carTemplate = root
        // The Ferrari model faces -Z; our carForward is +Z. Spin the
         // visible model 180° so it points the way it's driving.
        const playerCar = (root as unknown as { clone: (deep?: boolean) => THREE.Object3D }).clone(true)
        playerCar.rotation.y = Math.PI
        carGroup.add(playerCar)
        // Sit the car on the displaced terrain at spawn. Without this it
        // starts beneath a hill until the first time the player drives.
        carGroup.position.y = terrain.heightAt(carGroup.position.x, carGroup.position.z) + 0.08

        // Snap the camera so the first frame is a flattering chase shot.
        camTmp.copy(camOffset).applyQuaternion(carGroup.quaternion)
        camTmp.add(carGroup.position)
        camera.position.copy(camTmp)
        lookTmp.copy(carGroup.position)
        lookTmp.y += 0.8
        camera.lookAt(lookTmp.x, lookTmp.y, lookTmp.z)

        const ms = Math.round(performance.now() - t0)
        logLine(log, `loaded ${CAR_ASSET} in ${ms} ms`, 'ok')
        setStatus(status, 'ok', 'ready — drive')
        idleStartedAt = performance.now()
        connect()
      },
      undefined,
      (err: unknown) => {
        setStatus(status, 'fail', 'load failed')
        const msg =
          err && typeof err === 'object' && 'message' in err
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
      logLine(log, 'lobby connected', 'ok')
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
      } else if (msg.type === 'state') {
        recordStateArrival(performance.now())
        ingestPlayers(msg.players)
      } else if (msg.type === 'snapshot') {
        ingestPlayers(msg.players)
      } else if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t
        rttEma = Number.isNaN(rttEma) ? rtt : rttEma * 0.78 + rtt * 0.22
        hudRtt.textContent = String(Math.round(rttEma))
      }
    })

    ws.addEventListener('close', () => {
      if (pingTimer !== null) {
        clearInterval(pingTimer)
        pingTimer = null
      }
      logLine(log, 'lobby closed', 'info')
    })
    ws.addEventListener('error', () => logLine(log, 'socket error', 'fail'))
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
      scene.remove(g.mesh)
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
        // Ghost cars: wrap in a Group so the inner mesh keeps the same
         // 180° model-face fix while we drive the group's yaw from the wire.
        const ghostGroup = new THREE.Group()
        mesh.rotation.y = Math.PI
        ghostGroup.add(mesh)
        scene.add(ghostGroup)
        ghost = { mesh: ghostGroup, buffer: [] }
        ghosts.set(p.id, ghost)
      }
      ghost.buffer.push({ t: tNow, x: p.x, y: p.y, z: p.z, ry: p.ry })
      const cutoff = tNow - MAX_INTERP_MS * 4
      while (ghost.buffer.length > 2 && (ghost.buffer[1]?.t ?? 0) < cutoff) ghost.buffer.shift()
    }
    for (const [id, ghost] of ghosts) {
      if (!seen.has(id)) {
        scene.remove(ghost.mesh)
        ghosts.delete(id)
      }
    }
    // HUD reflects *all* players in the room including us.
    hudPlayers.textContent = String(players.length)
  }

  // ── Input ─────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (!stage.matches(':hover') && document.activeElement !== stage) return
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.w = true
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.s = true
    else if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.a = true
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.d = true
    else if (e.code === 'Space') keys.fire = true
    else return
    e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.w = false
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.s = false
    else if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.a = false
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.d = false
    else if (e.code === 'Space') keys.fire = false
  }
  window.addEventListener('keydown', onKeyDown, { passive: false })
  window.addEventListener('keyup', onKeyUp)

  // ── Render loop ───────────────────────────────────────────────────────
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrameAt) / 1000)
    lastFrameAt = now
    updateCar(dt)
    clampToArena()
    updateObjects(arenaObjects, dt)
    const collision = collideObjects(arenaObjects, carGroup, speed, playgroundConfig.physics.collisionBounce)
    speed = collision.speed
    if (collision.ramp && !airborne && Math.abs(speed) > 8) {
      airborne = true
      verticalVelocity = playgroundConfig.physics.rampLaunchVelocity
      logLine(log, 'launched off ramp', 'ok')
    }
    if (collision.crashed) logLine(log, `crashed into ${collision.crashed.kind}`, 'info')
    if (keys.fire && shooting.fire(carGroup, now)) hudShots.textContent = String(shooting.shots.length)
    const hit = shooting.update(now, dt, arenaObjects)
    if (hit) logLine(log, `hit ${hit.kind}`, 'ok')
    hudShots.textContent = String(shooting.shots.length)
    trackTopSpeed()
    updateCamera()
    interpolateGhosts(now)
    maybeSendMove(now)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  const updateCar = (dt: number) => {
    const touchThrottle = joystick.active ? -joystick.y : 0
    const touchSteer = joystick.active ? -joystick.x : 0
    const anyKey = keys.w || keys.a || keys.s || keys.d || Math.abs(touchThrottle) > 0.08 || Math.abs(touchSteer) > 0.08
    if (anyKey && !userHasDriven) userHasDriven = true
    if (!userHasDriven) {
      // Parked. The car does NOT move on its own — driving yourself off into
      // the distance while someone is just scrolling the page is disorienting.
      // We keep it perfectly still; the showroom camera (updateCamera) does
      // the gentle motion instead. Speed stays 0.
      speed = 0
      hudSpeed.textContent = '0'
      return
    }
    const physics = playgroundConfig.physics
    const throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0) + touchThrottle
    if (throttle > 0) speed += physics.acceleration * Math.min(1, throttle) * dt
    if (throttle < 0) speed += physics.reverseAcceleration * Math.max(-1, throttle) * dt
    const drag = Math.abs(throttle) > 0.04 ? physics.drag * 0.2 : physics.drag
    if (Math.abs(speed) > 0.01) speed -= Math.sign(speed) * drag * dt * Math.abs(speed)
    speed = Math.max(-physics.maxSpeed * 0.5, Math.min(physics.maxSpeed, speed))

    const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0) + touchSteer
    if (Math.abs(speed) > 0.05) {
      carGroup.rotation.y += Math.max(-1, Math.min(1, steer)) * physics.turnRate * dt * (speed / physics.maxSpeed)
    }
    carForward.set(Math.sin(carGroup.rotation.y), 0, Math.cos(carGroup.rotation.y))
    carGroup.position.x += carForward.x * speed * dt
    carGroup.position.z += carForward.z * speed * dt
    const groundY = terrain.heightAt(carGroup.position.x, carGroup.position.z) + 0.08
    if (airborne) {
      verticalVelocity -= physics.gravity * dt
      carGroup.position.y += verticalVelocity * dt
      if (carGroup.position.y <= groundY) {
        carGroup.position.y = groundY
        verticalVelocity = 0
        airborne = false
      }
    } else {
      carGroup.position.y = groundY
    }

    hudSpeed.textContent = String(Math.round(Math.abs(speed) * 2.2))
  }

  // Hard-clamp the car inside the arena so it can't tumble off the floor.
  const clampToArena = () => {
    const limit = ARENA_HALF - 4
    if (carGroup.position.x > limit) { carGroup.position.x = limit; speed *= 0.3 }
    if (carGroup.position.x < -limit) { carGroup.position.x = -limit; speed *= 0.3 }
    if (carGroup.position.z > limit) { carGroup.position.z = limit; speed *= 0.3 }
    if (carGroup.position.z < -limit) { carGroup.position.z = -limit; speed *= 0.3 }
  }

  const trackTopSpeed = () => {
    const mph = Math.round(Math.abs(speed) * 2.2)
    if (mph > topSpeed) {
      topSpeed = mph
      hudTopSpeed.textContent = String(topSpeed)
      // Post to leaderboard when top speed improves enough to matter.
      if (userHasDriven && topSpeed - lastPostedTopSpeed >= TOP_SPEED_POST_THRESHOLD) {
        lastPostedTopSpeed = topSpeed
        void postTopSpeed(nameInput.value.trim() || 'racer', topSpeed)
      }
    }
  }

  const updateCamera = () => {
    if (!userHasDriven) {
      // Showroom turntable: slowly orbit the parked car so the scene feels
      // alive without the car going anywhere. Stops the instant you drive.
      const tSec = (performance.now() - idleStartedAt) / 1000
      const angle = tSec * 0.18 // ~35s per revolution
      const radius = 9
      const height = 4.2
      camTmp.set(
        carGroup.position.x + Math.sin(angle) * radius,
        carGroup.position.y + height,
        carGroup.position.z + Math.cos(angle) * radius,
      )
      camera.position.lerp(camTmp, 0.06)
      lookTmp.copy(carGroup.position)
      lookTmp.y += 0.6
      camera.lookAt(lookTmp.x, lookTmp.y, lookTmp.z)
      return
    }
    // Chase cam once driving.
    camTmp.copy(camOffset).applyQuaternion(carGroup.quaternion)
    camTmp.add(carGroup.position)
    camera.position.lerp(camTmp, 0.18)
    lookTmp.copy(carGroup.position)
    lookTmp.y += 0.8
    camera.lookAt(lookTmp.x, lookTmp.y, lookTmp.z)
  }

  const recordStateArrival = (now: number) => {
    if (lastStateArrival > 0) {
      const gap = now - lastStateArrival
      const deviation = Math.abs(gap - SEND_MS)
      jitterEma = jitterEma * 0.85 + deviation * 0.15
      // One normal tick plus jitter headroom. Fast on healthy paths, resilient
      // if packets clump or drop. RTT is displayed but not added to the buffer.
      interpolationDelayMs = Math.max(
        MIN_INTERP_MS,
        Math.min(MAX_INTERP_MS, Math.round(MIN_INTERP_MS + jitterEma * 2.5)),
      )
      hudBuffer.textContent = String(interpolationDelayMs)
    }
    lastStateArrival = now
  }

  const interpolateGhosts = (now: number) => {
    const renderTime = now - interpolationDelayMs
    for (const [, ghost] of ghosts) {
      if (ghost.buffer.length === 0) continue
      const yaw = sampleAt(ghost.buffer, renderTime, ghostTmp)
      if (yaw === null) continue
      ghost.mesh.position.x = ghostTmp.x
      ghost.mesh.position.y = ghostTmp.y
      ghost.mesh.position.z = ghostTmp.z
      ghost.mesh.rotation.y = yaw
    }
  }

  const maybeSendMove = (now: number) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (now - lastSentAt < SEND_MS) return
    lastSentAt = now
    seq++
    send({
      type: 'move',
      x: carGroup.position.x,
      y: carGroup.position.y,
      z: carGroup.position.z,
      ry: carGroup.rotation.y,
      seq,
      t: now,
    })
  }

  async function postTopSpeed(playerName: string, mph: number): Promise<void> {
    try {
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${playerName} (${mph} mph)`.slice(0, 24),
          score: mph,
        }),
      })
    } catch (err) {
      logLine(log, `leaderboard post failed: ${(err as Error).message}`, 'fail')
    }
  }

  // ── Wire up DOM ───────────────────────────────────────────────────────
  const resize = () => {
    const w = stage.clientWidth || 480
    const h = Math.round(w * (9 / 16))
    renderer.setSize(w, h, true)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const fireProjectile = () => {
    if (shooting.fire(carGroup, performance.now())) {
      hudShots.textContent = String(shooting.shots.length)
      logLine(log, 'fired projectile', 'ok')
    }
  }

  const resetCar = () => {
    speed = 0
    verticalVelocity = 0
    airborne = false
    userHasDriven = false
    topSpeed = 0
    lastPostedTopSpeed = 0
    hudTopSpeed.textContent = '0'
    carGroup.position.set(0, terrain.heightAt(0, 0) + 0.08, 0)
    carGroup.rotation.y = 0
    shooting.reset()
    resetObjects(arenaObjects)
    hudShots.textContent = '0'
    idleStartedAt = performance.now()
  }

  // Thumb-stick pointer math: dead zone in the middle, then normalized analog
  // x/y to [-1, 1]. Pointer capture keeps steering if the thumb leaves the pad.
  const releaseJoystick = () => {
    joystick.x = 0
    joystick.y = 0
    joystick.active = false
    joystick.pointerId = -1
    joystickThumb.style.transform = 'translate(0px, 0px)'
  }
  const moveJoystick = (e: PointerEvent) => {
    const rect = joystickBase.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const max = rect.width * 0.34
    let dx = e.clientX - cx
    let dy = e.clientY - cy
    const len = Math.hypot(dx, dy)
    if (len > max) {
      dx = (dx / len) * max
      dy = (dy / len) * max
    }
    const dead = 0.1
    joystick.x = Math.abs(dx / max) < dead ? 0 : dx / max
    joystick.y = Math.abs(dy / max) < dead ? 0 : dy / max
    joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`
  }
  joystickBase.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    joystick.active = true
    joystick.pointerId = e.pointerId
    joystickBase.setPointerCapture(e.pointerId)
    stage.focus()
    moveJoystick(e)
  })
  joystickBase.addEventListener('pointermove', (e) => {
    if (joystick.active && e.pointerId === joystick.pointerId) moveJoystick(e)
  })
  joystickBase.addEventListener('pointerup', releaseJoystick)
  joystickBase.addEventListener('pointercancel', releaseJoystick)
  touchFire.addEventListener('click', (e) => {
    e.preventDefault()
    stage.focus()
    fireProjectile()
  })
  touchReset.addEventListener('click', resetCar)

  const controlsRow = el('div', {
    class: 'row desktop-control-row',
    children: [
      el('label', { class: 'field', children: [el('span', { text: 'name' }), nameInput] }),
      bigButton('Fire', fireProjectile),
      bigButton('Reset', resetCar),
      status,
    ],
  })

  const body = el('div', {
    class: 'panel-body',
    children: [
      stage,
      el('p', {
        class: 'help race-help',
        html:
          '<strong>Drive with the thumb stick or WASD. Fire with the button or Space.</strong> ' +
          'Climb hills, hit ramps, knock cones over, blast barriers. Open a second tab and you appear as a ghost car — every visitor on this URL shares the arena.',
      }),
      controlsRow,
      log,
    ],
  })

  queueMicrotask(() => {
    resize()
    window.addEventListener('resize', resize)
    stage.setAttribute('tabindex', '0')
    stage.addEventListener('click', () => stage.focus())
    raf = requestAnimationFrame(tick)
    void loadCar()
  })

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

  return panel(
    '2. Mini Arena (multiplayer, free roam)',
    'The Ferrari from R2 in a configurable playground: rolling terrain, cones, barriers, ramps, and local projectiles. Drive with WASD, shoot with Space. Every visitor shares the arena through a Durable Object at 20 Hz; top speed goes to the leaderboard.',
    body,
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

type Snapshot = { t: number; x: number; y: number; z: number; ry: number }
type Ghost = { mesh: THREE.Object3D; buffer: Snapshot[] }

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

// One texture tile covers this many world units. Smaller = denser grid =
// stronger sense of motion. 6 units per tile gives a clear reference grid.
const FLOOR_TILE_UNITS = 6

function buildArenaFloor(): THREE.Mesh {
  const size = ARENA_HALF * 2
  const geom = new THREE.PlaneGeometry(size, size)

  // A single grid cell drawn once; RepeatWrapping tiles it across the floor.
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')!
  // Light asphalt base with a faint checker so adjacent tiles read distinctly.
  g.fillStyle = '#d8d8d8'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#d0d0d0'
  g.fillRect(0, 0, 128, 128)
  g.fillRect(128, 128, 128, 128)
  // Cell border (the grid line) on two edges so tiling makes a clean lattice.
  g.strokeStyle = '#9a9a9a'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(256, 0)
  g.moveTo(0, 0)
  g.lineTo(0, 256)
  g.stroke()
  // A small center tick for extra motion reference.
  g.fillStyle = '#bcbcbc'
  g.fillRect(124, 124, 8, 8)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  const tiles = size / FLOOR_TILE_UNITS
  tex.repeat.set(tiles, tiles)

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 })
  ;(mat as unknown as { map: unknown }).map = tex
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = -0.01
  return mesh
}

function buildOriginMarker(groundY = 0): THREE.Mesh {
  // A small, low cylinder at the origin. The visual anchor of the arena
  // without being in the way of drivers.
  const geom = new THREE.PlaneGeometry(4, 4)
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')!
  g.fillStyle = 'rgba(0,0,0,0)'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#000'
  g.lineWidth = 4
  g.beginPath()
  g.arc(64, 64, 50, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#000'
  g.font = 'bold 72px Open Sans, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('v', 64, 68)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 })
  ;(mat as unknown as { map: unknown; transparent: boolean }).map = tex
  ;(mat as unknown as { transparent: boolean }).transparent = true
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = groundY + 0.02
  return mesh
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
