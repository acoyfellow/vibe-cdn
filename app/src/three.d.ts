// Minimal ambient typings so the no-framework UI compiles even though
// the installed `three` package does not ship its own .d.ts files.
// These are intentionally loose: enough to drive the small GLB demo.
declare module 'three' {
  export class Scene {
    background: unknown
    add(obj: unknown): void
  }
  export class PerspectiveCamera {
    constructor(fov: number, aspect: number, near: number, far: number)
    aspect: number
    position: { set(x: number, y: number, z: number): void }
    lookAt(x: number, y: number, z: number): void
    updateProjectionMatrix(): void
  }
  export class WebGLRenderer {
    constructor(params?: { antialias?: boolean; alpha?: boolean })
    domElement: HTMLCanvasElement
    setPixelRatio(r: number): void
    setSize(w: number, h: number, updateStyle?: boolean): void
    setClearColor(color: number, alpha?: number): void
    render(scene: Scene, camera: PerspectiveCamera): void
    dispose(): void
  }
  export class Color {
    constructor(c?: number | string)
  }
  export class AmbientLight {
    constructor(color?: number, intensity?: number)
  }
  export class DirectionalLight {
    constructor(color?: number, intensity?: number)
    position: { set(x: number, y: number, z: number): void }
  }
  export class GridHelper {
    constructor(size?: number, divisions?: number)
  }
  export class Object3D {
    rotation: { x: number; y: number; z: number }
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
    scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }
    add(child: unknown): void
    traverse(cb: (obj: unknown) => void): void
  }
  export class Box3 {
    setFromObject(obj: Object3D): this
    getSize(target: Vector3): Vector3
    getCenter(target: Vector3): Vector3
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
  }
  export class Mesh extends Object3D {
    constructor(geom?: unknown, mat?: unknown)
  }
  export class BoxGeometry {
    constructor(w?: number, h?: number, d?: number)
  }
  export class MeshStandardMaterial {
    constructor(params?: { color?: number | string; roughness?: number; metalness?: number })
  }
  export class MeshBasicMaterial {
    constructor(params?: { color?: number | string; wireframe?: boolean; side?: number })
  }
  export const DoubleSide: number
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Object3D } from 'three'
  export interface GLTF {
    scene: Object3D
    scenes: Object3D[]
    animations: unknown[]
    cameras: unknown[]
    asset: unknown
    parser: unknown
    userData: unknown
  }
  export class GLTFLoader {
    constructor()
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent | unknown) => void,
    ): void
    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (event: ErrorEvent | unknown) => void,
    ): void
  }
}
