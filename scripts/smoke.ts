#!/usr/bin/env bun
/**
 * End-to-end smoke test for the local Worker. Hits every public surface:
 *  - GET /health
 *  - GET /manifest.json
 *  - HEAD /assets/:key
 *  - GET /assets/:key (full body)
 *  - GET /assets/:key with valid Range
 *  - GET /assets/:key with invalid Range (start>end)
 *  - GET /assets/:key with If-None-Match (expect 304)
 *  - OPTIONS /assets/:key (CORS preflight)
 *  - GET/POST /api/scores
 *  - PUT/GET /api/saves/:player/:slot
 *  - WebSocket /ws/lobby/:id  (join, ping/pong, snapshot)
 *
 * Exit code is non-zero on the first failed assertion. Each check prints a
 * short PASS/FAIL line so logs stay greppable.
 */
// `ws` ships no type declarations and we deliberately don't depend on
// @types/ws, so load it via createRequire and cast to a minimal client shape.
import { createRequire } from 'node:module'

import type { AssetManifest, LobbyServerMessage } from '../src/shared/contracts'

type WSData = Buffer | ArrayBuffer | string
type WSClient = {
  on(event: 'open', listener: () => void): WSClient
  on(event: 'message', listener: (data: WSData) => void): WSClient
  on(event: 'error', listener: (err: Error) => void): WSClient
  on(event: 'close', listener: () => void): WSClient
  send(data: string): void
  close(): void
}
type WSCtor = new (url: string) => WSClient

const require_ = createRequire(import.meta.url)
const WebSocketClient: WSCtor = require_('ws') as WSCtor

type Check = { name: string; ok: boolean; detail?: string }

class Smoke {
  private checks: Check[] = []
  constructor(private workerUrl: string) {}

  private record(name: string, ok: boolean, detail?: string) {
    this.checks.push({ name, ok, detail })
    const tag = ok ? 'PASS' : 'FAIL'
    const suffix = detail ? `  (${detail})` : ''
    console.log(`${tag}  ${name}${suffix}`)
  }

  private assert(name: string, condition: boolean, detail?: string) {
    this.record(name, condition, condition ? detail : detail ?? 'assertion failed')
  }

  get failed(): boolean {
    return this.checks.some((c) => !c.ok)
  }

  async run(): Promise<void> {
    await this.health()
    const manifest = await this.manifest()
    const assetKey = pickAssetKey(manifest)
    if (assetKey) {
      await this.assetHead(assetKey)
      const etag = await this.assetGet(assetKey)
      await this.assetRange(assetKey)
      await this.assetInvalidRange(assetKey)
      if (etag) await this.assetIfNoneMatch(assetKey, etag)
      await this.assetCors(assetKey)
    } else {
      this.record('assets.pickKey', false, 'manifest had no usable asset')
    }
    await this.scores()
    await this.saves()
    await this.wsLobby()
  }

  private async health(): Promise<void> {
    const response = await fetch(`${this.workerUrl}/health`)
    const body = (await response.json().catch(() => null)) as { ok?: boolean; bindings?: Record<string, boolean> } | null
    this.assert('GET /health', response.status === 200 && body?.ok === true, `status=${response.status}`)
    this.assert('GET /health bindings present', !!body?.bindings && Object.values(body.bindings).every(Boolean), JSON.stringify(body?.bindings))
  }

  private async manifest(): Promise<AssetManifest | null> {
    const response = await fetch(`${this.workerUrl}/manifest.json`)
    const ok = response.status === 200
    if (!ok) {
      this.assert('GET /manifest.json', false, `status=${response.status}`)
      return null
    }
    const body = (await response.json().catch(() => null)) as AssetManifest | null
    this.assert('GET /manifest.json', !!body && Array.isArray(body.assets) && body.assets.length > 0, `assets=${body?.assets?.length ?? 0}`)
    return body
  }

  private async assetHead(key: string): Promise<void> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`, { method: 'HEAD' })
    const length = Number(response.headers.get('content-length') ?? '0')
    this.assert(`HEAD /assets/${key}`, response.status === 200 && length > 0, `status=${response.status} length=${length}`)
    this.assert(`HEAD /assets/${key} accept-ranges`, response.headers.get('accept-ranges') === 'bytes', response.headers.get('accept-ranges') ?? 'missing')
  }

  private async assetGet(key: string): Promise<string | null> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`)
    const ok = response.status === 200
    const etag = response.headers.get('etag')
    const cacheControl = response.headers.get('cache-control') ?? ''
    if (ok) {
      const buf = await response.arrayBuffer()
      this.assert(`GET /assets/${key}`, buf.byteLength > 0, `bytes=${buf.byteLength}`)
    } else {
      this.assert(`GET /assets/${key}`, false, `status=${response.status}`)
    }
    this.assert(`GET /assets/${key} cache-control immutable`, cacheControl.includes('immutable'), cacheControl)
    this.assert(`GET /assets/${key} etag present`, !!etag, etag ?? 'missing')
    return etag
  }

  private async assetRange(key: string): Promise<void> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`, { headers: { range: 'bytes=0-15' } })
    const buf = await response.arrayBuffer()
    const contentRange = response.headers.get('content-range') ?? ''
    this.assert(
      `GET /assets/${key} range`,
      response.status === 206 && buf.byteLength === 16 && /^bytes 0-15\/\d+$/.test(contentRange),
      `status=${response.status} bytes=${buf.byteLength} content-range=${contentRange}`,
    )
  }

  private async assetInvalidRange(key: string): Promise<void> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`, { headers: { range: 'bytes=20-5' } })
    // Worker policy: invalid (start>end) returns a 206 with zero-length payload.
    // Either a 4xx range-not-satisfiable OR a 206 with content-length=0 is acceptable.
    const length = Number(response.headers.get('content-length') ?? '0')
    const acceptable = response.status === 416 || (response.status === 206 && length === 0) || response.status === 200
    this.assert(`GET /assets/${key} invalid range`, acceptable, `status=${response.status} length=${length}`)
    // Drain body so we don't leak the stream.
    await response.arrayBuffer().catch(() => undefined)
  }

  private async assetIfNoneMatch(key: string, etag: string): Promise<void> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`, { headers: { 'if-none-match': etag } })
    this.assert(`GET /assets/${key} if-none-match`, response.status === 304, `status=${response.status}`)
    await response.arrayBuffer().catch(() => undefined)
  }

  private async assetCors(key: string): Promise<void> {
    const response = await fetch(`${this.workerUrl}/assets/${encodeURI(key)}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'range',
      },
    })
    const allowOrigin = response.headers.get('access-control-allow-origin') ?? ''
    this.assert(`OPTIONS /assets/${key} cors`, response.status === 204 && allowOrigin === '*', `status=${response.status} origin=${allowOrigin}`)
  }

  private async scores(): Promise<void> {
    const post = await fetch(`${this.workerUrl}/api/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'smoke', score: 42 }),
    })
    const postBody = (await post.json().catch(() => null)) as { ok?: boolean; score?: { id?: string } } | null
    this.assert('POST /api/scores', post.status === 200 && postBody?.ok === true && !!postBody?.score?.id, `status=${post.status}`)

    const get = await fetch(`${this.workerUrl}/api/scores`)
    const getBody = (await get.json().catch(() => null)) as { ok?: boolean; scores?: unknown[] } | null
    this.assert('GET /api/scores', get.status === 200 && getBody?.ok === true && Array.isArray(getBody.scores), `count=${getBody?.scores?.length ?? 0}`)
  }

  private async saves(): Promise<void> {
    const put = await fetch(`${this.workerUrl}/api/saves/smoke/slot1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 3, hp: 99 }),
    })
    const putBody = (await put.json().catch(() => null)) as { ok?: boolean } | null
    this.assert('PUT /api/saves/smoke/slot1', put.status === 200 && putBody?.ok === true, `status=${put.status}`)

    const get = await fetch(`${this.workerUrl}/api/saves/smoke/slot1`)
    const getBody = (await get.json().catch(() => null)) as { ok?: boolean; value?: { level?: number; hp?: number } | null } | null
    const value = getBody?.value ?? null
    this.assert(
      'GET /api/saves/smoke/slot1',
      get.status === 200 && getBody?.ok === true && value?.level === 3 && value?.hp === 99,
      `value=${JSON.stringify(value)}`,
    )
  }

  private async wsLobby(): Promise<void> {
    const wsUrl = this.workerUrl.replace(/^http/, 'ws') + '/ws/lobby/smoke'
    try {
      const result = await openLobbyClient(wsUrl)
      this.assert('WS /ws/lobby/smoke hello', !!result.hello, JSON.stringify(result.hello))
      this.assert('WS /ws/lobby/smoke snapshot', !!result.snapshot && Array.isArray(result.snapshot.players), `players=${result.snapshot?.players?.length ?? 0}`)
      this.assert('WS /ws/lobby/smoke pong', !!result.pong && result.pong.t === 12345, JSON.stringify(result.pong))
    } catch (err) {
      this.assert('WS /ws/lobby/smoke', false, String(err))
    }
  }
}

type LobbyTrace = {
  hello?: Extract<LobbyServerMessage, { type: 'hello' }>
  snapshot?: Extract<LobbyServerMessage, { type: 'snapshot' }>
  pong?: Extract<LobbyServerMessage, { type: 'pong' }>
}

async function openLobbyClient(url: string): Promise<LobbyTrace> {
  return await new Promise<LobbyTrace>((resolve, reject) => {
    const trace: LobbyTrace = {}
    const ws = new WebSocketClient(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('websocket timeout'))
    }, 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', name: 'smoke' }))
      ws.send(JSON.stringify({ type: 'ping', t: 12345 }))
    })
    ws.on('message', (data: Buffer | ArrayBuffer | string) => {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8')
      let msg: LobbyServerMessage
      try {
        msg = JSON.parse(text) as LobbyServerMessage
      } catch {
        return
      }
      if (msg.type === 'hello') trace.hello = msg
      else if (msg.type === 'snapshot') trace.snapshot = msg
      else if (msg.type === 'pong') trace.pong = msg
      if (trace.hello && trace.snapshot && trace.pong) {
        clearTimeout(timer)
        ws.close()
        resolve(trace)
      }
    })
    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })
    ws.on('close', () => {
      clearTimeout(timer)
      resolve(trace)
    })
  })
}

function pickAssetKey(manifest: AssetManifest | null): string | null {
  if (!manifest) return null
  const candidate = manifest.assets.find((a) => a.bytes >= 64) ?? manifest.assets[0]
  return candidate ? candidate.key : null
}

function parseArgs(argv: string[]): { workerUrl: string } {
  let workerUrl = process.env.WORKER_URL ?? 'http://127.0.0.1:8789'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--worker' || arg === '--worker-url') {
      const next = argv[++i]
      if (!next) throw new Error(`${arg} requires a value`)
      workerUrl = next
    } else if (arg?.startsWith('--worker=')) {
      workerUrl = arg.slice('--worker='.length)
    }
  }
  return { workerUrl: workerUrl.replace(/\/$/, '') }
}

async function main(): Promise<void> {
  const { workerUrl } = parseArgs(process.argv.slice(2))
  console.log(`smoke testing ${workerUrl}`)
  const smoke = new Smoke(workerUrl)
  await smoke.run()
  if (smoke.failed) {
    console.error('smoke FAILED')
    process.exit(1)
  }
  console.log('smoke OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
