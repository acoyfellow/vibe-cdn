// 3D model viewer panel. Loads a GLB from /assets/ through the worker and
// renders it with Three.js. Proves the asset path end-to-end: R2 -> Worker
// -> browser -> WebGL.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const ASSET_PATH = '/assets/demo/triangle.glb'

export function gltfPanel(): HTMLElement {
  const status = makeStatus('idle', 'not loaded')
  const log = el('div', { class: 'log' })
  const stage = el('div', { class: 'gltf-stage' })
  const meta = el('div', { class: 'kv-grid' })

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 100)
  camera.position.set(2.2, 1.8, 2.2)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 1)
  stage.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(3, 4, 2)
  scene.add(sun as unknown as object)
  // Faint white grid against the black inverse-card background.
  scene.add(new THREE.GridHelper(8, 16) as unknown as object)

  let model: THREE.Object3D | null = null
  let raf = 0

  const resize = () => {
    const w = stage.clientWidth || 480
    const h = Math.round(w * (9 / 16))
    renderer.setSize(w, h, true)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const tick = () => {
    if (model) model.rotation.y += 0.01
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  const load = async () => {
    setStatus(status, 'busy', 'loading…')
    meta.innerHTML = ''
    if (model) {
      // Re-mount fresh model: detach by recreating scene children minus lights/grid
      // is overkill; just leave previous in place and add new one offset.
    }
    const loader = new GLTFLoader()
    const t0 = performance.now()
    let lastLoaded = 0
    loader.load(
      ASSET_PATH,
      (gltf) => {
        const ms = Math.round(performance.now() - t0)
        const root = gltf.scene
        // Fit to view by scaling to ~1.5 units max dimension.
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const s = 1.5 / maxDim
        root.scale.set(s, s, s)
        root.position.set(-center.x * s, -center.y * s, -center.z * s)
        if (model) scene.add(root as unknown as object)
        else scene.add(root as unknown as object)
        model = root

        // The bundled triangle has no normals or materials; override with an
         // unlit basic white material so it reads against the black stage.
        let meshCount = 0
        const whiteUnlit = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        root.traverse((obj: unknown) => {
          const o = obj as { isMesh?: boolean; material?: unknown }
          if (o.isMesh) {
            meshCount++
            o.material = whiteUnlit
          }
        })

        const rows: [string, string][] = [
          ['Asset', ASSET_PATH],
          ['Bytes loaded', String(lastLoaded)],
          ['Load time', `${ms} ms`],
          ['Meshes', String(meshCount)],
        ]
        for (const [k, v] of rows) {
          meta.appendChild(
            el('div', {
              class: 'kv-row',
              children: [
                el('span', { class: 'kv-key', text: k }),
                el('span', { class: 'kv-val', text: v }),
              ],
            }),
          )
        }
        setStatus(status, 'ok', `loaded in ${ms} ms`)
        logLine(log, `GET ${ASSET_PATH} → ok (${ms} ms)`, 'ok')
      },
      (event: ProgressEvent) => {
        if (event.lengthComputable) {
          lastLoaded = event.loaded
          const pct = ((event.loaded / event.total) * 100).toFixed(0)
          setStatus(status, 'busy', `${pct}% (${event.loaded} / ${event.total} B)`)
        } else {
          lastLoaded = event.loaded
          setStatus(status, 'busy', `${event.loaded} B`)
        }
      },
      (err: unknown) => {
        setStatus(status, 'fail', 'load failed')
        const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : String(err)
        logLine(log, `GLTFLoader error: ${msg}`, 'fail')
      },
    )
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', { class: 'row', children: [bigButton('Load model', load), status] }),
      stage,
      meta,
      log,
    ],
  })

  // Boot: size, render loop, first load.
  queueMicrotask(() => {
    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(tick)
    void load()
  })

  // Best-effort cleanup if the panel is removed.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(body)) {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      renderer.dispose()
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return panel(
    '2. Model loader (Three.js GLB)',
    `Loads ${ASSET_PATH} from local R2 through the Worker. The Worker sets MIME, immutable cache, and ETag.`,
    body,
  )
}
