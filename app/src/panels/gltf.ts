// 3D model viewer panel. Loads a GLB from /assets/ through the worker and
// renders it with Three.js. Proves the asset path end-to-end:
// R2 -> Worker -> browser -> WebGL.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const ASSET_PATH = '/assets/demo/helmet.glb'

export function gltfPanel(): HTMLElement {
  const status = makeStatus('idle', 'not loaded')
  const log = el('div', { class: 'log' })
  const stage = el('div', { class: 'gltf-stage' })
  const meta = el('div', { class: 'kv-grid' })

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 100)
  camera.position.set(2.6, 1.6, 2.6)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 1)
  stage.appendChild(renderer.domElement)

  // PBR lighting that flatters most Khronos sample assets.
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(3, 4, 2)
  scene.add(key as unknown as object)
  const fill = new THREE.DirectionalLight(0x99ccff, 0.45)
  fill.position.set(-3, 2, -2)
  scene.add(fill as unknown as object)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.6
  controls.minDistance = 1.2
  controls.maxDistance = 8
  controls.target.set(0, 0, 0)

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
    controls.update()
    if (model) model.rotation.y += 0.003
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  const load = async () => {
    setStatus(status, 'busy', 'loading…')
    meta.innerHTML = ''
    const loader = new GLTFLoader()
    const t0 = performance.now()
    let lastLoaded = 0
    loader.load(
      ASSET_PATH,
      (gltf) => {
        const ms = Math.round(performance.now() - t0)
        const root = gltf.scene

        // Fit to view: scale so the longest dimension is ~1.6 units,
        // recenter, lift slightly so the model sits above the origin.
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const s = 1.6 / maxDim
        root.scale.set(s, s, s)
        root.position.set(-center.x * s, -center.y * s, -center.z * s)
        scene.add(root as unknown as object)
        model = root

        let meshCount = 0
        root.traverse((obj: unknown) => {
          const o = obj as { isMesh?: boolean }
          if (o.isMesh) meshCount++
        })

        const rows: [string, string][] = [
          ['Asset', ASSET_PATH],
          ['Bytes loaded', lastLoaded ? lastLoaded.toLocaleString() : '—'],
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
          setStatus(status, 'busy', `${pct}% (${(event.loaded / 1024).toFixed(0)} KB)`)
        } else {
          lastLoaded = event.loaded
          setStatus(status, 'busy', `${(event.loaded / 1024).toFixed(0)} KB`)
        }
      },
      (err: unknown) => {
        setStatus(status, 'fail', 'load failed')
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : String(err)
        logLine(log, `GLTFLoader error: ${msg}`, 'fail')
      },
    )
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', { class: 'row', children: [bigButton('Load model', load), status] }),
      stage,
      el('p', { class: 'help', text: 'drag to orbit, scroll to zoom' }),
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
      controls.dispose()
      renderer.dispose()
      observer.disconnect()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return panel(
    '2. Model loader (Three.js GLB)',
    `Loads ${ASSET_PATH} from R2 through the Worker. The Worker sets MIME, immutable cache, and ETag. The Khronos "Damaged Helmet" — about 3.7 MB with embedded PBR textures.`,
    body,
  )
}
