import * as THREE from 'three'
import type { PlaygroundConfig } from './config'
import type { Terrain } from './terrain'
import type { ArenaObject } from './objects'
import { applyProjectileImpact, hitObject } from './objects'

export type Shot = {
  mesh: THREE.Mesh
  vx: number
  vz: number
  born: number
}

export type Impact = {
  mesh: THREE.Mesh
  born: number
}

export class ShootingSystem {
  shots: Shot[] = []
  impacts: Impact[] = []
  private lastFireAt = -Infinity

  constructor(
    private scene: THREE.Scene,
    private config: PlaygroundConfig,
    private terrain: Terrain,
  ) {}

  fire(car: THREE.Object3D, now: number): boolean {
    if (!this.config.weapons.enabled) return false
    if (now - this.lastFireAt < this.config.weapons.fireCooldownMs) return false
    this.lastFireAt = now
    const forwardX = Math.sin(car.rotation.y)
    const forwardZ = Math.cos(car.rotation.y)
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5e1f, roughness: 0.25, metalness: 0.35 }),
    )
    const x = car.position.x + forwardX * 2.1
    const z = car.position.z + forwardZ * 2.1
    mesh.position.set(x, this.terrain.heightAt(x, z) + 0.72, z)
    this.scene.add(mesh)
    this.shots.push({
      mesh,
      vx: forwardX * this.config.weapons.projectileSpeed,
      vz: forwardZ * this.config.weapons.projectileSpeed,
      born: now,
    })
    return true
  }

  update(now: number, dt: number, objects: ArenaObject[]): ArenaObject | undefined {
    let struck: ArenaObject | undefined
    this.shots = this.shots.filter((shot) => {
      shot.mesh.position.x += shot.vx * dt
      shot.mesh.position.z += shot.vz * dt
      shot.mesh.position.y = this.terrain.heightAt(shot.mesh.position.x, shot.mesh.position.z) + 0.72
      const target = hitObject(objects, shot.mesh.position.x, shot.mesh.position.z, this.config.weapons.impactRadius)
      const expired = now - shot.born > this.config.weapons.projectileLifeMs
      const out = Math.abs(shot.mesh.position.x) > this.config.terrain.arenaHalf || Math.abs(shot.mesh.position.z) > this.config.terrain.arenaHalf
      if (target || expired || out) {
        this.scene.remove(shot.mesh)
        if (target) {
          // Cones can topple and slide. Solid barriers and ramps absorb the
          // hit but must not suddenly rotate or stand on end.
          const magnitude = Math.hypot(shot.vx, shot.vz) || 1
          applyProjectileImpact(target, shot.vx / magnitude, shot.vz / magnitude)
          this.impact(shot.mesh.position.x, shot.mesh.position.z, now)
          struck = target
        }
        return false
      }
      return true
    })
    this.impacts = this.impacts.filter((impact) => {
      const age = now - impact.born
      const s = 1 + age / 120
      impact.mesh.scale.set(s, s, s)
      if (age > 240) {
        this.scene.remove(impact.mesh)
        return false
      }
      return true
    })
    return struck
  }

  reset(): void {
    for (const s of this.shots) this.scene.remove(s.mesh)
    for (const i of this.impacts) this.scene.remove(i.mesh)
    this.shots = []
    this.impacts = []
  }

  private impact(x: number, z: number, now: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff5e1f, wireframe: true }),
    )
    mesh.position.set(x, this.terrain.heightAt(x, z) + 0.75, z)
    this.scene.add(mesh)
    this.impacts.push({ mesh, born: now })
  }
}
