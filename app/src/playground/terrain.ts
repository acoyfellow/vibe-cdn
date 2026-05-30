import * as THREE from 'three'
import type { PlaygroundConfig } from './config'

export type Terrain = {
  mesh: THREE.Mesh
  heightAt(x: number, z: number): number
}

// Smooth deterministic hill field: gaussian landmark hills + low rolling waves.
// It is cheap to sample every frame for car/projectile grounding and later maps
// directly to hill-height/scale sliders in the builder UI.
export function createTerrain(config: PlaygroundConfig): Terrain {
  const { arenaHalf, resolution } = config.terrain
  const size = arenaHalf * 2
  const segments = resolution
  const geom = new THREE.PlaneGeometry(size, size, segments, segments)
  const heightAt = (x: number, z: number): number => {
    if (!config.terrain.enabled) return 0
    const h = config.terrain.hillHeight
    const s = config.terrain.hillScale
    const wave =
      Math.sin(x * s * 1.4) * Math.cos(z * s * 1.08) * h * 0.45 +
      Math.sin((x + z) * s * 0.7) * h * 0.16
    const bump = (cx: number, cz: number, radius: number, amount: number) => {
      const dx = x - cx
      const dz = z - cz
      return amount * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius))
    }
    return wave +
      // Two obvious driveable hills in the initial forward sightline.
      bump(-15, 30, 16, h * 0.95) +
      bump(20, 54, 20, h * 1.25) +
      bump(42, -26, 22, h * 0.85) +
      bump(-46, 32, 27, h * 1.15) -
      bump(5, 70, 18, h * 0.42)
  }

  // PlaneGeometry is X/Y before rotation; write elevation into local Z then
  // rotate the mesh onto X/Z ground.
  const pos = (geom as unknown as { attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; setZ(i: number, z: number): void; needsUpdate: boolean } } }).attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, heightAt(pos.getX(i), -pos.getY(i)))
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()

  const tex = buildGridTexture(size / config.terrain.tileUnits)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 })
  ;(mat as unknown as { map: THREE.CanvasTexture }).map = tex
  const mesh = new THREE.Mesh(geom, mat)
  mesh.rotation.x = -Math.PI / 2
  return { mesh, heightAt }
}

function buildGridTexture(repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')!
  g.fillStyle = '#d6d7d9'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#cfd1d4'
  g.fillRect(0, 0, 128, 128)
  g.fillRect(128, 128, 128, 128)
  g.strokeStyle = '#9b9ea3'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(256, 0)
  g.moveTo(0, 0)
  g.lineTo(0, 256)
  g.stroke()
  g.fillStyle = '#ff5e1f'
  g.beginPath()
  g.arc(128, 128, 5, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 8
  return tex
}
