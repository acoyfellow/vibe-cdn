// Minimal ambient typings for `three` 0.181.x. The installed package does
// not ship its own .d.ts files. Keep these loose; they exist to make
// `bun run check` pass, not to perfectly model Three.js.

declare module 'three' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
    copy(v: Vector3): this
    clone(): Vector3
    add(v: Vector3): this
    addScaledVector(v: Vector3, s: number): this
    sub(v: Vector3): this
    subVectors(a: Vector3, b: Vector3): this
    crossVectors(a: Vector3, b: Vector3): this
    normalize(): this
    multiplyScalar(s: number): this
    lerp(v: Vector3, alpha: number): this
    lerpVectors(a: Vector3, b: Vector3, alpha: number): this
    dot(v: Vector3): number
    length(): number
    lengthSq(): number
    applyQuaternion(q: Quaternion): this
  }

  export class Quaternion {
    constructor(x?: number, y?: number, z?: number, w?: number)
    x: number
    y: number
    z: number
    w: number
  }

  export class Object3D {
    position: Vector3
    rotation: { x: number; y: number; z: number }
    scale: Vector3
    quaternion: Quaternion
    add(...children: unknown[]): this
    remove(...children: unknown[]): this
    clone(recursive?: boolean): this
    traverse(callback: (obj: unknown) => void): void
    getWorldDirection(target: Vector3): Vector3
  }

  export class Scene extends Object3D {
    background: unknown
    fog: unknown
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number)
    aspect: number
    lookAt(x: number | Vector3, y?: number, z?: number): void
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

  export class AmbientLight extends Object3D {
    constructor(color?: number, intensity?: number)
  }

  export class HemisphereLight extends Object3D {
    constructor(skyColor?: number, groundColor?: number, intensity?: number)
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number)
  }

  export class Fog {
    constructor(color: number, near: number, far: number)
  }

  export class GridHelper extends Object3D {
    constructor(size?: number, divisions?: number, color1?: number, color2?: number)
  }

  export class Box3 {
    setFromObject(obj: Object3D): this
    getSize(target: Vector3): Vector3
    getCenter(target: Vector3): Vector3
  }

  export class Mesh extends Object3D {
    constructor(geom?: unknown, mat?: unknown)
    geometry: unknown
    material: unknown
  }

  export class Group extends Object3D {
    constructor()
  }

  export class BoxGeometry {
    constructor(w?: number, h?: number, d?: number)
  }

  export class PlaneGeometry {
    constructor(w?: number, h?: number)
  }

  export class BufferGeometry {
    setAttribute(name: string, attr: BufferAttribute): this
    setIndex(indices: number[] | Uint16Array | Uint32Array): this
    computeVertexNormals(): void
  }

  export class BufferAttribute {
    constructor(array: Float32Array | Uint16Array | Uint32Array, itemSize: number)
  }

  export class CatmullRomCurve3 {
    constructor(points: Vector3[], closed?: boolean, curveType?: string, tension?: number)
    getPointAt(t: number, target?: Vector3): Vector3
    getTangentAt(t: number, target?: Vector3): Vector3
  }

  export class Vector2 {
    constructor(x?: number, y?: number)
    x: number
    y: number
    set(x: number, y: number): this
  }

  export class CanvasTexture {
    constructor(canvas: HTMLCanvasElement)
    wrapS: number
    wrapT: number
    repeat: Vector2
    anisotropy: number
    needsUpdate: boolean
  }

  export class MeshStandardMaterial {
    constructor(params?: {
      color?: number | string
      roughness?: number
      metalness?: number
      map?: unknown
    })
  }

  export class MeshBasicMaterial {
    constructor(params?: { color?: number | string; wireframe?: boolean; side?: number })
  }

  export const DoubleSide: number
  export const ACESFilmicToneMapping: number
  export const SRGBColorSpace: string
  export const RepeatWrapping: number
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import type { Object3D } from 'three'
  import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
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
    setDRACOLoader(dracoLoader: DRACOLoader): this
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

declare module 'three/examples/jsm/loaders/DRACOLoader.js' {
  export class DRACOLoader {
    constructor()
    setDecoderPath(path: string): this
    setDecoderConfig(config: { type?: 'js' | 'wasm' }): this
    preload(): this
    dispose(): void
  }
}

declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import type { PerspectiveCamera, Vector3 } from 'three'
  export class OrbitControls {
    constructor(camera: PerspectiveCamera, element: HTMLElement)
    enableDamping: boolean
    dampingFactor: number
    rotateSpeed: number
    minDistance: number
    maxDistance: number
    target: Vector3
    update(): void
    dispose(): void
  }
}
