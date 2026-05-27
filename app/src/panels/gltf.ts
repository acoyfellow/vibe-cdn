// 3D model viewer panel. Loads a GLB from /assets/ through the worker and
// renders it with Three.js. Two assets to choose from — the racing-game
// Ferrari (primary) and the Khronos Damaged Helmet (PBR reference).

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

type AssetSpec = {
  key: string
  label: string
  path: string
  blurb: string
  camera: [number, number, number]
}

const ASSETS: AssetSpec[] = [
  {
    key: 'car',
    label: 'Ferrari',
    path: '/assets/demo/car.glb',
    blurb: '~1.6 MB PBR car body, clearcoat paint, transmission glass — three.js reference racing asset.',
    camera: [4.2, 1.6, 5.0],
  },
  {
    key: 'helmet',
    label: 'Helmet',
    path: '/assets/demo/helmet.glb',
    blurb: '~3.7 MB Khronos Damaged Helmet, embedded PBR textures, emissive details.',
    camera: [2.6, 1.6, 2.6],
  },
]

export function gltfPanel(): HTMLElement {
  const status = makeStatus('idle', 'not loaded')
  const log = el('div', { class: 'log' })
  const stage = el('div', { class: 'gltf-stage' })
  const meta = el('div', { class: 'kv-grid' })
  const blurb = el('p', { class: 'help', text: ASSETS[0]!.blurb })
  const toggleRow = el('div', { class: 'row' })

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 200)
  camera.position.set(...ASSETS[0]!.camera)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 1)
  stage.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xffffff, 1.8)
  key.position.set(4, 6, 3)
  scene.add(key as unknown as object)
  const fill = new THREE.DirectionalLight(0x99ccff, 0.5)
  fill.position.set(-4, 3, -3)
  scene.add(fill as unknown as object)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.6
  controls.minDistance = 1.2
  controls.maxDistance = 16
  controls.target.set(0, 0, 0)

  let model: THREE.Object3D | null = null
  let raf = 0
  let current: AssetSpec = ASSETS[0]!

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

  const detachModel = () => {
    if (!model) return
    const sceneObj = scene as unknown as { remove(child: unknown): void }
    sceneObj.remove(model)
    model = null
  }

  const load = async (asset: AssetSpec) => {
    current = asset
    blurb.textContent = asset.blurb
    camera.position.set(...asset.camera)
    controls.target.set(0, 0, 0)
    controls.update()

    setStatus(status, 'busy', 'loading…')
    meta.innerHTML = ''
    detachModel()

    const loader = new GLTFLoader()
    const t0 = performance.now()
    let lastLoaded = 0
    loader.load(
      asset.path,
      (gltf) => {
        const ms = Math.round(performance.now() - t0)
        const root = gltf.scene
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const s = 1.8 / maxDim
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
          ['Asset', asset.path],
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
        logLine(log, `GET ${asset.path} → ok (${ms} ms)`, 'ok')
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

  for (const asset of ASSETS) {
    const btn = bigButton(asset.label, () => load(asset))
    btn.dataset.assetKey = asset.key
    toggleRow.appendChild(btn)
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      toggleRow,
      stage,
      el('p', { class: 'help', text: 'drag to orbit, scroll to zoom' }),
      blurb,
      meta,
      log,
    ],
  })

  queueMicrotask(() => {
    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(tick)
    void load(current)
  })

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
    'Loads a GLB from R2 through the Worker. Two assets, both PBR. Switch between them and watch the cache status flip.',
    body,
  )
}
