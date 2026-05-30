import * as THREE from 'three'
import type { PlaygroundConfig } from './config'
import type { Terrain } from './terrain'

// Collision shapes are deliberately explicit, because a visible 6×1 barrier
// cannot be represented by a 3.3m circle without an awful invisible fence.
// Rectangles are oriented boxes in the X/Z ground plane; cones are tiny circles.
export type ArenaObject = {
  id: string
  kind: 'cone' | 'barrier' | 'ramp'
  mesh: THREE.Object3D
  x: number
  z: number
  yaw: number
  shape:
    | { type: 'circle'; radius: number }
    | { type: 'box'; halfX: number; halfZ: number }
  movable: boolean
  hit: boolean
  // Knockable props (cones only): animated impulse state rather than an
  // instant teleport/rotation, so collisions read physically.
  knockVx?: number
  knockVz?: number
  knockSpin?: number
  tilt?: number
  initialX: number
  initialZ: number
  initialYaw: number
}

export type CarFootprint = {
  halfX: number // car width / 2
  halfZ: number // car length / 2
}

// Ferrari normalized to about 3m longest dimension; width is substantially
// narrower. Slight padding stops interpenetration without visible air gaps.
export const CAR_FOOTPRINT: CarFootprint = { halfX: 0.78, halfZ: 1.52 }

export function createObjects(config: PlaygroundConfig, terrain: Terrain): ArenaObject[] {
  if (!config.objects.enabled) return []
  const rng = mulberry32(config.objects.seed)
  const out: ArenaObject[] = []
  const place = (margin = 18) => ({
    x: (rng() * 2 - 1) * (config.terrain.arenaHalf - margin),
    z: (rng() * 2 - 1) * (config.terrain.arenaHalf - margin),
  })

  const addBarrier = (id: string, x: number, z: number, yaw = 0) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.25, 1),
      new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.8 }),
    )
    mesh.position.set(x, terrain.heightAt(x, z) + 0.62, z)
    mesh.rotation.y = yaw
    out.push({
      id,
      kind: 'barrier',
      mesh,
      x,
      z,
      yaw,
      shape: { type: 'box', halfX: 3, halfZ: 0.5 },
      movable: false,
      hit: false,
      initialX: x,
      initialZ: z,
      initialYaw: yaw,
    })
  }

  const addRamp = (id: string, x: number, z: number, yaw = 0) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.45, 7),
      new THREE.MeshStandardMaterial({ color: 0xff7038, roughness: 0.65, metalness: 0.1 }),
    )
    mesh.position.set(x, terrain.heightAt(x, z) + 0.38, z)
    mesh.rotation.x = -0.19
    mesh.rotation.y = yaw
    out.push({
      id,
      kind: 'ramp',
      mesh,
      x,
      z,
      yaw,
      shape: { type: 'box', halfX: 2.5, halfZ: 3.5 },
      movable: false,
      hit: false,
      initialX: x,
      initialZ: z,
      initialYaw: yaw,
    })
  }

  // A designed first sightline: objects are visible, but no invisible walls.
  addBarrier('landmark-barrier-l', -10, 18, Math.PI / 8)
  addBarrier('landmark-barrier-r', 10, 27, -Math.PI / 8)
  addRamp('landmark-ramp', 0, 43, 0)

  for (let i = 0; i < config.objects.cones; i++) {
    const p = place(12)
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.65, 1.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xff5e1f, roughness: 0.7 }),
    )
    mesh.position.set(p.x, terrain.heightAt(p.x, p.z) + 0.75, p.z)
    out.push({
      id: `cone-${i}`,
      kind: 'cone',
      mesh,
      x: p.x,
      z: p.z,
      yaw: 0,
      shape: { type: 'circle', radius: 0.65 },
      movable: true,
      hit: false,
      initialX: p.x,
      initialZ: p.z,
      initialYaw: 0,
    })
  }
  for (let i = 0; i < config.objects.barriers; i++) {
    const p = place(20)
    addBarrier(`barrier-${i}`, p.x, p.z, rng() * Math.PI)
  }
  for (let i = 0; i < config.objects.ramps; i++) {
    const p = place(28)
    addRamp(`ramp-${i}`, p.x, p.z, rng() * Math.PI)
  }
  return out
}

export function collideObjects(
  objects: ArenaObject[],
  car: THREE.Object3D,
  speed: number,
  bounce: number,
): { speed: number; crashed?: ArenaObject; ramp?: boolean } {
  for (const object of objects) {
    // Once a cone is knocked over, let the car pass through its settling
    // visual rather than treating it like an invisible solid barrier.
    if (object.kind === 'cone' && object.hit) continue
    const hit = carVsObject(car, object, CAR_FOOTPRINT)
    if (!hit) continue
    if (object.kind === 'ramp') return { speed, ramp: true }
    if (object.movable && !object.hit) {
      object.hit = true
      // Kick cones over with velocity, not a one-frame teleport. The update
      // loop damps this impulse over time.
      const impulse = Math.max(2, Math.min(12, Math.abs(speed) * 0.7))
      object.knockVx = -hit.normalX * impulse
      object.knockVz = -hit.normalZ * impulse
      object.knockSpin = (hit.normalX >= 0 ? -1 : 1) * 3.8
      object.tilt = 0
      return { speed: speed * 0.86, crashed: object }
    }
    // Exact minimum translation vector from the oriented overlap pushes only
    // by the actual penetration depth rather than an arbitrary circle radius.
    car.position.x += hit.normalX * hit.depth
    car.position.z += hit.normalZ * hit.depth
    return { speed: -speed * bounce, crashed: object }
  }
  return { speed }
}

export function hitObject(objects: ArenaObject[], x: number, z: number, radius: number): ArenaObject | undefined {
  return objects.find((object) => {
    // knocked cones are already spent; barriers/ramps continue to receive
    // projectile impacts without changing orientation.
    if (object.hit && object.kind === 'cone') return false
    if (object.shape.type === 'circle') {
      return Math.hypot(object.x - x, object.z - z) <= object.shape.radius + radius
    }
    const local = toLocal(x, z, object)
    return (
      Math.abs(local.x) <= object.shape.halfX + radius &&
      Math.abs(local.z) <= object.shape.halfZ + radius
    )
  })
}

type Hit = { depth: number; normalX: number; normalZ: number }

function carVsObject(car: THREE.Object3D, object: ArenaObject, carShape: CarFootprint): Hit | null {
  if (object.shape.type === 'circle') {
    return obbVsCircle(car.position.x, car.position.z, car.rotation.y, carShape, object)
  }
  return obbVsObb(
    { x: car.position.x, z: car.position.z, yaw: car.rotation.y, halfX: carShape.halfX, halfZ: carShape.halfZ },
    { x: object.x, z: object.z, yaw: object.yaw, halfX: object.shape.halfX, halfZ: object.shape.halfZ },
  )
}

// Oriented car rectangle vs small circle (cones), calculated in car-local space.
function obbVsCircle(cx: number, cz: number, yaw: number, car: CarFootprint, object: ArenaObject): Hit | null {
  const dx = object.x - cx
  const dz = object.z - cz
  const c = Math.cos(-yaw)
  const s = Math.sin(-yaw)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const qx = clamp(lx, -car.halfX, car.halfX)
  const qz = clamp(lz, -car.halfZ, car.halfZ)
  const vx = lx - qx
  const vz = lz - qz
  const d = Math.hypot(vx, vz)
  const radius = object.shape.type === 'circle' ? object.shape.radius : 0
  if (d >= radius) return null
  const nlx = d > 0.0001 ? -vx / d : -Math.sign(lx || 1)
  const nlz = d > 0.0001 ? -vz / d : -Math.sign(lz || 1)
  const wc = Math.cos(yaw)
  const ws = Math.sin(yaw)
  return {
    depth: radius - d + 0.01,
    normalX: nlx * wc - nlz * ws,
    normalZ: nlx * ws + nlz * wc,
  }
}

// Separating Axis Theorem for two oriented rectangles in X/Z. Returns the
// smallest translation axis/depth, so barrier collisions match visible edges.
function obbVsObb(
  a: { x: number; z: number; yaw: number; halfX: number; halfZ: number },
  b: { x: number; z: number; yaw: number; halfX: number; halfZ: number },
): Hit | null {
  const axes = [axis(a.yaw, 0), axis(a.yaw, 1), axis(b.yaw, 0), axis(b.yaw, 1)]
  const dx = a.x - b.x
  const dz = a.z - b.z
  let minOverlap = Infinity
  let minAxis = { x: 0, z: 0 }
  for (const ax of axes) {
    const dist = Math.abs(dx * ax.x + dz * ax.z)
    const ra = projectedRadius(a, ax)
    const rb = projectedRadius(b, ax)
    const overlap = ra + rb - dist
    if (overlap <= 0) return null
    if (overlap < minOverlap) {
      minOverlap = overlap
      const sign = dx * ax.x + dz * ax.z < 0 ? -1 : 1
      minAxis = { x: ax.x * sign, z: ax.z * sign }
    }
  }
  return { depth: minOverlap + 0.01, normalX: minAxis.x, normalZ: minAxis.z }
}

function axis(yaw: number, longitudinal: 0 | 1): { x: number; z: number } {
  return longitudinal === 0
    ? { x: Math.cos(yaw), z: -Math.sin(yaw) }
    : { x: Math.sin(yaw), z: Math.cos(yaw) }
}

function projectedRadius(
  rect: { yaw: number; halfX: number; halfZ: number },
  onto: { x: number; z: number },
): number {
  const xAxis = axis(rect.yaw, 0)
  const zAxis = axis(rect.yaw, 1)
  return (
    rect.halfX * Math.abs(xAxis.x * onto.x + xAxis.z * onto.z) +
    rect.halfZ * Math.abs(zAxis.x * onto.x + zAxis.z * onto.z)
  )
}

function toLocal(x: number, z: number, object: ArenaObject): { x: number; z: number } {
  const dx = x - object.x
  const dz = z - object.z
  const c = Math.cos(-object.yaw)
  const s = Math.sin(-object.yaw)
  return { x: dx * c - dz * s, z: dx * s + dz * c }
}

export function updateObjects(objects: ArenaObject[], dt: number): void {
  for (const object of objects) {
    if (object.kind !== 'cone' || !object.hit) continue
    const vx = object.knockVx ?? 0
    const vz = object.knockVz ?? 0
    const spin = object.knockSpin ?? 0
    const tilt = Math.min(1.36, (object.tilt ?? 0) + Math.abs(spin) * dt)
    object.tilt = tilt
    object.mesh.rotation.z = Math.sign(spin || 1) * tilt
    object.mesh.position.x += vx * dt
    object.mesh.position.z += vz * dt
    object.x = object.mesh.position.x
    object.z = object.mesh.position.z
    // Friction: smooth slide/roll to rest within about one second.
    const damping = Math.exp(-5.5 * dt)
    object.knockVx = vx * damping
    object.knockVz = vz * damping
    object.knockSpin = spin * damping
  }
}

export function resetObjects(objects: ArenaObject[]): void {
  for (const object of objects) {
    object.hit = false
    object.knockVx = 0
    object.knockVz = 0
    object.knockSpin = 0
    object.tilt = 0
    object.x = object.initialX
    object.z = object.initialZ
    object.yaw = object.initialYaw
    object.mesh.position.x = object.initialX
    object.mesh.position.z = object.initialZ
    object.mesh.rotation.y = object.initialYaw
    object.mesh.rotation.z = 0
  }
}

export function applyProjectileImpact(object: ArenaObject, dirX: number, dirZ: number): void {
  if (object.kind !== 'cone') return
  if (object.hit) return
  object.hit = true
  object.knockVx = dirX * 10
  object.knockVz = dirZ * 10
  object.knockSpin = (dirX >= 0 ? -1 : 1) * 4.2
  object.tilt = 0
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
