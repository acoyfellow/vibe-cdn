# Mini Race — Implementation Reference

Concrete, well-trodden patterns for a Three.js + Cloudflare Durable Object multiplayer racing demo. Each section: minimal snippet + source.

Existing repo state (vibe-cdn):
- `app/src/panels/gltf.ts` — Three.js + GLTFLoader + OrbitControls (loads `/assets/demo/car.glb`)
- `src/worker/LobbyDO.ts` — DO already broadcasts `{type:'move',x,y,z}` and `{type:'snapshot',players:[...]}`
- `src/shared/contracts.ts` — `LobbyClientMessage` / `LobbyServerMessage` already define `move`/`snapshot`/`ping`/`pong`

---

## 1. WASD + pointer-look camera controls

Pragmatic pattern: `PointerLockControls` for mouse-look (yaw via `controls.object`, pitch via internal camera euler), key-state flags for WASD, integrate in render loop with `delta`.

For a car (not first-person), the usual variant: WASD controls **car heading + throttle**, and the camera **chase-follows** the car. Mouse-look is optional (free-look camera while car keeps its own heading). The PointerLockControls pattern below is the canonical Three.js example; adapt by replacing the camera-translation with car-translation.

```js
// From three.js/examples/misc_controls_pointerlock.html (canonical)
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => controls.lock());

const keys = { w:false, a:false, s:false, d:false };
addEventListener('keydown', e => { if (e.code==='KeyW') keys.w=true; if (e.code==='KeyA') keys.a=true; if (e.code==='KeyS') keys.s=true; if (e.code==='KeyD') keys.d=true; });
addEventListener('keyup',   e => { if (e.code==='KeyW') keys.w=false; if (e.code==='KeyA') keys.a=false; if (e.code==='KeyS') keys.s=false; if (e.code==='KeyD') keys.d=false; });

// in render loop, dt in seconds
const SPEED = 8;
const dir = new THREE.Vector3((+keys.d)-(+keys.a), 0, (+keys.s)-(+keys.w)).normalize();
if (dir.lengthSq() > 0) {
  controls.moveRight(dir.x * SPEED * dt);
  controls.moveForward(-dir.z * SPEED * dt);  // forward is -Z
}
```

**Car variant (recommended for Mini Race)** — keep mouse for camera, drive car with WASD:

```js
// car is a THREE.Object3D (the loaded Ferrari root)
const car = model; // from GLTFLoader
let speed = 0;
const TURN = 1.8;    // rad/sec at full lock
const ACCEL = 12;    // m/s^2
const DRAG  = 2.5;
const MAX_SPEED = 22;
const forward = new THREE.Vector3();

function updateCar(dt) {
  if (keys.w) speed = Math.min(speed + ACCEL*dt, MAX_SPEED);
  if (keys.s) speed = Math.max(speed - ACCEL*dt, -MAX_SPEED*0.4);
  speed *= Math.exp(-DRAG*dt * (keys.w||keys.s ? 0.1 : 1));
  const steer = (keys.a?1:0) - (keys.d?1:0);
  // only turn when moving (real-car feel)
  car.rotation.y += steer * TURN * dt * (speed / MAX_SPEED);
  car.getWorldDirection(forward);
  car.position.addScaledVector(forward, speed * dt);
}
```

Chase camera (no PointerLockControls needed):

```js
const camOffset = new THREE.Vector3(0, 2.2, -5.5); // behind & above
const tmp = new THREE.Vector3();
function updateChaseCam() {
  tmp.copy(camOffset).applyQuaternion(car.quaternion).add(car.position);
  camera.position.lerp(tmp, 0.12);
  camera.lookAt(car.position.x, car.position.y + 0.8, car.position.z);
}
```

**Sources:**
- PointerLockControls full example: https://github.com/mrdoob/three.js/blob/master/examples/misc_controls_pointerlock.html
- PointerLockControls docs: https://threejs.org/docs/#examples/en/controls/PointerLockControls

---

## 2. Procedural racetrack (flat ribbon with centerline)

Pragmatic approach: build a closed `THREE.CatmullRomCurve3` from a handful of control points, sample N points along it, then either (a) extrude a flat ribbon by emitting two vertices per sample (left and right of the curve tangent) into a `BufferGeometry`, or (b) use `TubeGeometry` flattened. **(a) is simpler and gives a true flat road.**

```js
import * as THREE from 'three';

function buildTrack({ width = 8, segments = 256 } = {}) {
  // Closed loop: a few hand-placed waypoints in XZ plane (Y=0)
  const pts = [
    new THREE.Vector3( 60,  0,  0),
    new THREE.Vector3( 40,  0,  40),
    new THREE.Vector3(  0,  0,  55),
    new THREE.Vector3(-40,  0,  45),
    new THREE.Vector3(-60,  0,  10),
    new THREE.Vector3(-50,  0, -30),
    new THREE.Vector3(-10,  0, -55),
    new THREE.Vector3( 30,  0, -45),
    new THREE.Vector3( 55,  0, -20),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, /*closed*/ true, 'catmullrom', 0.5);

  // Sample curve and build a ribbon: 2 verts per sample (left, right of tangent)
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs       = new Float32Array((segments + 1) * 2 * 2);
  const up = new THREE.Vector3(0, 1, 0);
  const tmpT = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpP = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, tmpP);
    curve.getTangentAt(t, tmpT);
    tmpN.crossVectors(tmpT, up).normalize().multiplyScalar(width / 2);

    positions.set([tmpP.x - tmpN.x, 0, tmpP.z - tmpN.z], i*6 + 0);
    positions.set([tmpP.x + tmpN.x, 0, tmpP.z + tmpN.z], i*6 + 3);
    // U=0 left, U=1 right; V tiles along length for stripe texture
    uvs.set([0, t * segments / 4, 1, t * segments / 4], i*4);
  }

  // Index strip: two triangles per segment
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const a = i*2, b = i*2+1, c = i*2+2, d = i*2+3;
    indices.push(a, b, d,  a, d, c);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  // Center-line stripe via a procedural canvas texture (no external assets)
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2a2a'; g.fillRect(0,0,64,512);
  g.fillStyle = '#ffeb3b'; // dashed yellow centerline
  for (let y = 0; y < 512; y += 64) g.fillRect(30, y, 4, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

  return { mesh: new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })), curve };
}
```

**Why this works:** Catmull-Rom guarantees C1-continuous curves through your points; closed=true joins last→first. The ribbon is "extrude perpendicular to tangent in the ground plane" — minimal, flat, no banking. ~70 lines. The returned `curve` is reusable for AI cars, start-line placement, lap detection, and minimap.

**Sources:**
- CatmullRomCurve3 docs: https://threejs.org/docs/#api/en/extras/curves/CatmullRomCurve3
- Curve.getPointAt / getTangentAt (uniform-arc-length sampling): https://threejs.org/docs/#api/en/extras/core/Curve
- Similar ribbon-from-curve pattern used in `RollerCoasterGeometry`: https://threejs.org/docs/#examples/en/misc/RollerCoasterGeometry

---

## 3. Lap detection (line crossing with direction check)

Standard pattern: pick a finish-line **segment** (two endpoints `A`, `B`) and the expected **forward direction** (track tangent at the line). Each frame, check whether the segment from `prevPos → currPos` crosses `A→B`, AND that the car's motion vector is roughly aligned with the forward direction (prevents counting a backwards crossing).

```js
// Line-segment intersection in 2D (XZ plane). Returns true if P1P2 crosses AB.
function segmentsCross(p1, p2, a, b) {
  const d = (b.x - a.x) * (p2.z - p1.z) - (b.z - a.z) * (p2.x - p1.x);
  if (Math.abs(d) < 1e-9) return false;
  const s = ((p2.z - p1.z) * (b.x - p1.x) - (p2.x - p1.x) * (b.z - p1.z)) / d;
  const t = ((b.z - a.z) * (b.x - p1.x) - (b.x - a.x) * (b.z - p1.z)) / d;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

const lineA = new THREE.Vector3( /* set from curve.getPointAt(0) offset by ±width/2 */ );
const lineB = new THREE.Vector3();
const lineForward = new THREE.Vector3(); // curve.getTangentAt(0), normalized

let lap = 0;
const prevPos = car.position.clone();
const motion  = new THREE.Vector3();

function checkLap() {
  motion.subVectors(car.position, prevPos);
  // Must be moving AND in the right direction (dot > 0)
  if (motion.lengthSq() > 1e-6 && motion.dot(lineForward) > 0) {
    if (segmentsCross(prevPos, car.position, lineA, lineB)) {
      lap++;
      console.log('LAP', lap);
    }
  }
  prevPos.copy(car.position);
}
```

**Optional anti-cheat / robustness:** require the car to have passed a **midpoint checkpoint** (halfway around the curve) since the last lap, so a player can't wiggle across the start line to rack up laps. Track `passedHalf:boolean`, set true when the car crosses a second segment placed at `t=0.5`, reset to false on lap increment.

**Sources:**
- Classic 2D segment-segment intersection (used in pretty much every racing/karting tutorial). Reference write-up: https://stackoverflow.com/questions/9043805/test-if-two-lines-intersect-javascript-function
- Direction-gated lap counting is the standard in indie racing tutorials (e.g. Unity Karting microgame, Godot kart demo).

---

## 4. Ghost-car snapshot interpolation

Standard pattern (Gaffer On Games "Snapshot Interpolation"): keep a small buffer of received `{pos, t}` snapshots per remote player. In the render loop, compute `renderTime = now() - INTERP_DELAY` (interp delay = ~2× server send interval, so even with one lost packet you still have a snapshot on either side). Find the two snapshots that bracket `renderTime` and lerp.

```js
const INTERP_DELAY_MS = 150; // for 10 Hz send rate; use ~100ms at 20 Hz

// Per remote player:
//   buffer: Array<{ t: number, pos: THREE.Vector3, yaw: number }>  (sorted ascending by t)

function pushSnapshot(buf, t, x, y, z, yaw) {
  buf.push({ t, pos: new THREE.Vector3(x, y, z), yaw });
  // Discard anything older than we'd ever interpolate against
  const cutoff = performance.now() - INTERP_DELAY_MS * 4;
  while (buf.length > 2 && buf[1].t < cutoff) buf.shift();
}

const _out = new THREE.Vector3();
function sampleAt(buf, renderTime, outPos) {
  if (buf.length === 0) return null;
  if (buf.length === 1 || renderTime <= buf[0].t) { outPos.copy(buf[0].pos); return buf[0].yaw; }
  if (renderTime >= buf[buf.length-1].t) { const s = buf[buf.length-1]; outPos.copy(s.pos); return s.yaw; }
  for (let i = 0; i < buf.length - 1; i++) {
    const a = buf[i], b = buf[i+1];
    if (renderTime >= a.t && renderTime <= b.t) {
      const u = (renderTime - a.t) / (b.t - a.t);
      outPos.lerpVectors(a.pos, b.pos, u);
      // shortest-arc yaw lerp
      let dy = b.yaw - a.yaw;
      if (dy >  Math.PI) dy -= Math.PI*2;
      if (dy < -Math.PI) dy += Math.PI*2;
      return a.yaw + dy * u;
    }
  }
  return buf[buf.length-1].yaw;
}

// In render loop, for each remote ghost:
const renderTime = performance.now() - INTERP_DELAY_MS;
const yaw = sampleAt(ghost.buffer, renderTime, _out);
if (yaw !== null) {
  ghost.mesh.position.copy(_out);
  ghost.mesh.rotation.y = yaw;
}
```

**Notes from Gaffer:**
- Linear interpolation is "good enough" for car position. Hermite/Catmull-Rom is nicer but rarely worth the complexity for a demo.
- Do **not** extrapolate past the last snapshot; it almost always looks worse than just freezing. (Gaffer: "extrapolation doesn't work very well for rigid bodies because their motion is non-linear and unpredictable.")
- `INTERP_DELAY` of `3× send interval` survives 2 dropped packets back-to-back at 2-5% loss.

**Sources:**
- Glenn Fiedler, *Snapshot Interpolation*: https://gafferongames.com/post/snapshot_interpolation/
- Valve's *Source Multiplayer Networking* (same pattern, ships in CS:GO/TF2): https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking

---

## 5. Durable Object multiplayer message format & rate

The existing `LobbyDO.ts` already does the right thing structurally (broadcast snapshot on each `move`). For a racing game, three small upgrades:

**Message shape:**

```ts
// Client → Server (10–20 Hz)
type MoveMsg = {
  type: 'move'
  x: number; y: number; z: number   // position
  ry: number                         // yaw in radians (most important for ghosts)
  vx?: number; vz?: number           // optional: linear velocity for dead-reckoning / hermite
  s?: number                         // optional: speed (for engine sound on remotes)
  seq: number                        // client-side monotonic sequence; lets server drop reorders
  t: number                          // client send time (performance.now()) — server echoes back
}

// Server → Clients (broadcast batched at fixed tick, NOT per-message)
type StateMsg = {
  type: 'state'
  tick: number                       // server tick number
  serverNow: number                  // Date.now() at broadcast — lets clients estimate clock skew
  players: Array<{
    id: string
    x: number; y: number; z: number
    ry: number
    lap?: number
  }>
}
```

**Rate-limiting rules (well-trodden):**

| Direction | Rate | Why |
|---|---|---|
| Client → DO `move` | **10–20 Hz** (every 50–100 ms) | Smooth ghosts without melting bandwidth. 20 Hz is the sweet spot for cars. |
| DO → All clients `state` | **10–20 Hz** (`setInterval`-driven tick, NOT per-message broadcast) | Decouples broadcast rate from input rate. Coalesces N players' updates into 1 send. |
| `ping`/`pong` | 1 Hz | Clock-sync + liveness. |

**DO changes (sketch):**

```ts
// In LobbyDO constructor, start a fixed-rate broadcast tick:
state.blockConcurrencyWhile(async () => {
  this.tickHandle = setInterval(() => this.broadcastTick(), 50); // 20 Hz
});

private handleMove(socket: WebSocket, msg: MoveMsg) {
  const p = this.sessions.get(socket);
  if (!p) return;
  if (msg.seq <= (p.lastSeq ?? -1)) return; // drop out-of-order
  p.lastSeq = msg.seq;
  p.x = finite(msg.x); p.y = finite(msg.y); p.z = finite(msg.z);
  p.ry = finite(msg.ry);
  p.seenAt = Date.now();
  // NOTE: no broadcast() here — let the tick fan out.
}

private broadcastTick() {
  const players = Array.from(this.sessions.values()).map(p => ({
    id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, lap: p.lap
  }));
  const msg = JSON.stringify({ type: 'state', tick: ++this.tick, serverNow: Date.now(), players });
  for (const sock of this.sessions.keys()) sock.send(msg);
}
```

**Two small but important nuances:**

1. **Don't broadcast on every `move`** (the current `LobbyDO.ts` does this). With N=10 players each sending 20 Hz, that's 200 incoming messages/sec → 200 fan-outs × 10 sockets = 2000 sends/sec. With a fixed 20 Hz tick it's 200 sends/sec, constant.
2. **No dead reckoning needed for a demo at 20 Hz with 150 ms interp delay.** Add velocity fields to the message only if you drop to 5–10 Hz and need predictive extrapolation. Gaffer's article above is explicit: linear interpolation on snapshots from 10 Hz looks shockingly good.

**Sources:**
- Cloudflare Durable Objects + input/output gates (why per-DO single-threaded broadcasts are safe & fast): https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
- Cloudflare multiplayer-globe template (canonical DO + WebSocket fan-out pattern in production): https://github.com/cloudflare/templates/tree/main/multiplayer-globe-template
- PartyKit racing-style examples (same DO-as-room model): https://docs.partykit.io/examples/
- Tick rate / send rate guidance from Valve & Gaffer (cited in §4).

---

## Putting it together (file-level guesses for vibe-cdn)

- New panel `app/src/panels/race.ts` — mostly a copy of `gltf.ts` plus the car-control, track-build, lap-detect, and ghost-render code above.
- Modify `src/shared/contracts.ts` — extend `LobbyClientMessage` `move` to include `ry`, `seq`, `t`; rename `LobbyServerMessage` `snapshot` to `state` and add `ry`, `tick`, `serverNow` (or keep both for back-compat).
- Modify `src/worker/LobbyDO.ts` — store `ry`/`lastSeq` per session, replace per-message `broadcast()` with a 20 Hz `setInterval` tick.
- Keep using the existing Ferrari `/assets/demo/car.glb`. Clone it per remote player with `SkeletonUtils.clone` (or just `gltf.scene.clone(true)` since it's not skinned).
