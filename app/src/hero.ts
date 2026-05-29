// The page hero. Three pieces:
//   1. Live stats ticker (mono, calm, ticking).
//   2. Title + tagline.
//   3. Drop Zone — drag any .glb (or other allowed type) onto the page and
//      get back a short URL on Cloudflare's edge. This is the product.

import { el } from './dom'
import { brand } from './brand'

type Stats = {
  assetsStored: number
  assetsBytes: number
  uploadsStored: number
  uploadsBytes: number
  scoresCount: number
  savesCount: number
  generatedAt: string
}

type UploadResponse =
  | {
      ok: true
      url: string
      key: string
      bytes: number
      contentType: string
      sha256: string
      expiresAt: string
    }
  | { ok: false; error: string }

const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_EXT = new Map<string, string>([
  ['glb', 'model/gltf-binary'],
  ['gltf', 'model/gltf+json'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['ktx2', 'image/ktx2'],
  ['wasm', 'application/wasm'],
  ['bin', 'application/octet-stream'],
])

export function buildHero(): HTMLElement {
  const head = el('header', { class: 'hero' })

  const ticker = el('div', { class: 'ticker', text: 'loading live stats…' })

  const titleRow = el('div', {
    class: 'hero-title-row',
    children: [
      el('h1', { class: 'hero-title', text: brand.wordmark }),
      el('span', { class: 'tag', text: '0.1.0' }),
    ],
  })

  const tagline = el('p', {
    class: 'hero-tagline',
    text:
      "Your browser game's assets on Cloudflare's edge. R2 for the heavy stuff, Workers for the CDN, free egress at any scale.",
  })

  // Drop zone
  const drop = el('div', { class: 'drop-zone', attrs: { tabindex: '0', role: 'button' } })

  const dropPrompt = el('div', {
    class: 'drop-prompt',
    children: [
      el('p', { class: 'drop-headline', text: 'drop a .glb here' }),
      el('p', {
        class: 'drop-sub',
        text: 'or click to pick. Up to 10 MB. Goes on R2 with a 24-hour TTL. Returns a public, edge-cached URL.',
      }),
      el('p', { class: 'drop-hint mono', text: '.glb · .gltf · .png · .webp · .ktx2 · .wasm · .bin' }),
    ],
  })

  const dropResult = el('div', { class: 'drop-result hidden' })

  const fileInput = el('input', {
    class: 'drop-file-input',
    attrs: {
      type: 'file',
      accept: '.glb,.gltf,.png,.jpg,.jpeg,.webp,.avif,.ktx2,.wasm,.bin,model/*,image/*',
    },
  })

  drop.appendChild(dropPrompt)
  drop.appendChild(dropResult)
  drop.appendChild(fileInput)

  head.appendChild(ticker)
  head.appendChild(titleRow)
  head.appendChild(tagline)
  head.appendChild(drop)

  // Behavior
  wireDropZone(drop, fileInput, dropPrompt, dropResult)
  void pollTicker(ticker)

  return head
}

// ── Drop zone wiring ──────────────────────────────────────────────────────

function wireDropZone(
  drop: HTMLElement,
  fileInput: HTMLInputElement,
  prompt: HTMLElement,
  result: HTMLElement,
) {
  let busy = false

  const reset = () => {
    drop.classList.remove('drop-hot', 'drop-busy', 'drop-ok', 'drop-fail')
    prompt.classList.remove('hidden')
    result.classList.add('hidden')
    result.innerHTML = ''
    busy = false
  }

  drop.addEventListener('click', (e) => {
    if (busy) return
    if (e.target instanceof HTMLElement && (e.target.classList.contains('copy-btn') || e.target.closest('.copy-btn'))) {
      return
    }
    if (e.target instanceof HTMLElement && (e.target.classList.contains('reset-btn') || e.target.closest('.reset-btn'))) {
      return
    }
    if (e.target instanceof HTMLAnchorElement) return
    fileInput.click()
  })

  drop.addEventListener('keydown', (ev) => {
    if (busy) return
    const e = ev as KeyboardEvent
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInput.click()
    }
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void upload(file)
    fileInput.value = ''
  })

  ;(['dragenter', 'dragover'] as const).forEach((evt) => {
    drop.addEventListener(evt, (ev) => {
      ev.preventDefault()
      if (busy) return
      drop.classList.add('drop-hot')
    })
  })
  ;(['dragleave', 'dragend'] as const).forEach((evt) => {
    drop.addEventListener(evt, () => drop.classList.remove('drop-hot'))
  })
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault()
    if (busy) return
    drop.classList.remove('drop-hot')
    const file = ev.dataTransfer?.files?.[0]
    if (file) void upload(file)
  })

  // Also accept files dropped anywhere on the document so the drop zone
  // doesn't have to be the strict target.
  document.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer?.types.includes('Files')) ev.preventDefault()
  })
  document.addEventListener('drop', (ev) => {
    if (busy) return
    if (!ev.dataTransfer?.files?.length) return
    const target = ev.target as HTMLElement | null
    if (target && drop.contains(target)) return // already handled
    ev.preventDefault()
    const file = ev.dataTransfer.files[0]
    if (file) void upload(file)
  })

  const upload = async (file: File) => {
    busy = true
    prompt.classList.add('hidden')
    drop.classList.remove('drop-hot', 'drop-ok', 'drop-fail')
    drop.classList.add('drop-busy')
    result.classList.remove('hidden')
    result.innerHTML = ''

    // Pick a content-type. Prefer file.type, fall back to extension lookup.
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const contentType = file.type || ALLOWED_EXT.get(ext) || 'application/octet-stream'

    result.appendChild(
      el('p', {
        class: 'drop-status',
        children: [
          el('span', { class: 'mono', text: file.name }),
          el('span', { text: '  ·  ' }),
          el('span', { class: 'mono', text: `${(file.size / 1024).toFixed(1)} KB` }),
          el('span', { text: '  ·  uploading…' }),
        ],
      }),
    )

    if (file.size > MAX_BYTES) {
      showError(`file too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Max is ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`)
      return
    }

    const t0 = performance.now()
    let response: Response
    try {
      response = await fetch('/api/u', {
        method: 'POST',
        headers: {
          'content-type': contentType,
          'x-filename': file.name.slice(0, 120),
        },
        body: file,
      })
    } catch (err) {
      showError(`network error: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const ms = Math.round(performance.now() - t0)
    let body: UploadResponse
    try {
      body = (await response.json()) as UploadResponse
    } catch {
      showError(`bad response (${response.status})`)
      return
    }

    if (!response.ok || !body.ok) {
      showError(`upload failed: ${'error' in body ? body.error : `HTTP ${response.status}`}`)
      return
    }

    drop.classList.remove('drop-busy')
    drop.classList.add('drop-ok')
    showSuccess(body, ms)
  }

  const showError = (message: string) => {
    drop.classList.remove('drop-busy', 'drop-ok')
    drop.classList.add('drop-fail')
    result.innerHTML = ''
    result.appendChild(el('p', { class: 'drop-error', text: message }))
    result.appendChild(
      el('button', {
        class: 'reset-btn',
        text: 'try again',
        on: { click: reset },
      }),
    )
    busy = false
  }

  const showSuccess = (body: Extract<UploadResponse, { ok: true }>, ms: number) => {
    const fullUrl = `${location.origin}${body.url}`
    const sizeKb = (body.bytes / 1024).toFixed(1)
    const expiresIn = humanRelative(body.expiresAt)
    const sha = body.sha256.slice(0, 12)

    const snippet = `loader.load('${body.url}', (gltf) => scene.add(gltf.scene))`

    result.innerHTML = ''

    result.appendChild(
      el('div', {
        class: 'drop-success',
        children: [
          el('p', { class: 'drop-status drop-status-ok', text: `uploaded in ${ms} ms` }),
          el('div', {
            class: 'url-row',
            children: [
              el('a', {
                class: 'url-link mono',
                attrs: { href: body.url, target: '_blank', rel: 'noreferrer' },
                text: fullUrl,
              }),
              copyButton(fullUrl, 'copy url'),
            ],
          }),
          el('div', {
            class: 'kv-grid drop-meta',
            children: [
              kvRow('size', `${sizeKb} KB`),
              kvRow('content-type', body.contentType),
              kvRow('sha256', sha + '…'),
              kvRow('expires', expiresIn),
            ],
          }),
          el('p', { class: 'drop-snippet-label', text: 'Three.js:' }),
          el('div', {
            class: 'snippet-row',
            children: [
              el('code', { class: 'snippet mono', text: snippet }),
              copyButton(snippet, 'copy snippet'),
            ],
          }),
          el('div', {
            class: 'cta-row',
            children: [
              el('button', { class: 'reset-btn', text: 'upload another', on: { click: reset } }),
              el('a', {
                class: 'cta-deploy',
                attrs: {
                  href: `https://deploy.workers.cloudflare.com/?url=${brand.repo}`,
                  target: '_blank',
                  rel: 'noreferrer',
                },
                text: 'deploy this for your game →',
              }),
            ],
          }),
        ],
      }),
    )
  }
}

function copyButton(text: string, label: string): HTMLButtonElement {
  const btn = el('button', {
    class: 'copy-btn',
    text: label,
    on: {
      click: async (ev) => {
        ev.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          btn.textContent = 'copied'
          setTimeout(() => (btn.textContent = label), 1200)
        } catch {
          btn.textContent = 'copy failed'
          setTimeout(() => (btn.textContent = label), 1200)
        }
      },
    },
  })
  return btn
}

function kvRow(k: string, v: string): HTMLElement {
  return el('div', {
    class: 'kv-row',
    children: [el('span', { class: 'kv-key', text: k }), el('span', { class: 'kv-val', text: v })],
  })
}

function humanRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

// ── Stats ticker ──────────────────────────────────────────────────────────

async function pollTicker(ticker: HTMLElement): Promise<void> {
  const render = (s: Stats) => {
    ticker.innerHTML = ''
    const segments: [string, string][] = [
      [`${s.assetsStored}`, 'assets'],
      [humanBytes(s.assetsBytes), 'on R2'],
      [`${s.uploadsStored}`, 'live uploads'],
      [`${s.scoresCount}`, 'scores'],
      [`${s.savesCount}`, 'saves'],
    ]
    for (let i = 0; i < segments.length; i++) {
      const [value, label] = segments[i]!
      ticker.appendChild(
        el('span', {
          class: 'ticker-seg',
          children: [
            el('span', { class: 'ticker-val mono', text: value }),
            el('span', { class: 'ticker-lbl', text: label }),
          ],
        }),
      )
      if (i < segments.length - 1) {
        ticker.appendChild(el('span', { class: 'ticker-sep', text: '·' }))
      }
    }
  }

  const tick = async () => {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' })
      if (res.ok) {
        const stats = (await res.json()) as Stats
        render(stats)
      }
    } catch {
      // leave previous render up
    }
  }

  await tick()
  setInterval(tick, 15_000)
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
