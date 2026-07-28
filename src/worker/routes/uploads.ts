// Public drop-zone uploads. Sandboxed, bounded, and ephemeral.
//
//   POST /api/u            body: raw bytes, headers: content-type, x-filename
//   GET  /u/:key           serves the uploaded blob
//
// Hardening (v1, no Turnstile yet):
//   - 10 MB body cap (server-enforced via Content-Length).
//   - 5 uploads / IP / hour via a KV-backed counter (rolling per-hour key).
//   - Allow-list of content types (glb/gltf/bin/ktx2/png/jpeg/webp/wasm).
//   - Random 8-char base62 key under the `u/` prefix.
//   - Stored in the `UPLOADS` R2 bucket which has a 24h lifecycle rule
//     applied at the bucket level (auto-deletion is R2's job, not ours).
//   - Public GETs are CORS-open and cache-immutable for 24h.

import { clientIp, hourBucket, rateCounterKey, rateDecision } from '../../shared/ratelimit'
import { contentTypeForKey } from '../../shared/mime'
import type { Env } from '../env'
import { corsHeaders, json, withCors } from '../http'

const MAX_BYTES = 10 * 1024 * 1024
const RATE_LIMIT_PER_HOUR = 5
const KEY_PREFIX = 'u/'
const KEY_LENGTH = 8
const ALLOWED_PREFIXES = new Set([
  'model/gltf-binary',
  'model/gltf+json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/ktx2',
  'application/octet-stream',
  'application/wasm',
])

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (request.method !== 'POST') {
    return withCors(json({ ok: false, error: 'method not allowed' }, { status: 405 }))
  }

  // 1. Size check from Content-Length. We don't trust it, but anything bigger
  // than declared is a non-starter.
  const declaredSize = Number(request.headers.get('content-length') ?? '0')
  if (declaredSize > MAX_BYTES) {
    return withCors(json({ ok: false, error: `file too large; max ${MAX_BYTES} bytes` }, { status: 413 }))
  }

  // 2. Content-type allow-list. We accept on the way in; the bucket only
  // stores types we've vetted.
  const declaredType = (request.headers.get('content-type') ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  if (!ALLOWED_PREFIXES.has(declaredType)) {
    return withCors(
      json(
        { ok: false, error: `unsupported content-type "${declaredType}"; allowed: ${[...ALLOWED_PREFIXES].join(', ')}` },
        { status: 415 },
      ),
    )
  }

  // 3. Per-IP rate limit. CF gives us `cf-connecting-ip`; if absent we still
  // count under "anon" so local dev exercises the path.
  const ip = clientIp(request.headers.get('cf-connecting-ip'))
  const counterKey = rateCounterKey('upload', ip, hourBucket(Date.now()))
  const decision = rateDecision(await env.SAVES.get(counterKey), RATE_LIMIT_PER_HOUR)
  if (!decision.allowed) {
    return withCors(
      json(
        { ok: false, error: `rate limit: ${decision.limit} uploads per hour per IP. try again later.` },
        { status: 429, headers: { 'retry-after': '3600' } },
      ),
    )
  }
  const current = decision.used

  // 4. Read the body up to the cap. The Worker fetch body is a stream; we
  // tee it through a TransformStream that aborts past MAX_BYTES.
  const buf = await readBodyWithCap(request, MAX_BYTES)
  if (!buf) {
    return withCors(json({ ok: false, error: `file too large; max ${MAX_BYTES} bytes` }, { status: 413 }))
  }
  if (buf.byteLength === 0) {
    return withCors(json({ ok: false, error: 'empty body' }, { status: 400 }))
  }

  // 5. Generate key. Random 8-char base62 + extension derived from content-type.
  const extension = pickExtension(declaredType)
  const id = randomBase62(KEY_LENGTH)
  const key = `${KEY_PREFIX}${id}${extension}`
  const sha256 = await sha256Hex(buf)

  await env.UPLOADS.put(key, buf, {
    httpMetadata: {
      contentType: declaredType,
      cacheControl: 'public, max-age=86400, immutable',
    },
    customMetadata: {
      contentType: declaredType,
      sha256,
      uploadedAt: new Date().toISOString(),
      ip,
      filename: (request.headers.get('x-filename') ?? '').slice(0, 120),
    },
  })

  // 6. Bump rate counter (TTL 1h).
  await env.SAVES.put(counterKey, String(current + 1), { expirationTtl: 3600 })

  const url = `/u/${id}${extension}`
  return withCors(
    json({
      ok: true,
      url,
      key,
      bytes: buf.byteLength,
      contentType: declaredType,
      sha256,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    }),
  )
}

export async function handlePublicGet(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withCors(json({ ok: false, error: 'method not allowed' }, { status: 405 }))
  }
  if (!key) return withCors(json({ ok: false, error: 'missing key' }, { status: 400 }))

  const objectKey = `${KEY_PREFIX}${key}`
  const head = await env.UPLOADS.head(objectKey)
  if (!head) return withCors(json({ ok: false, error: 'not found or expired' }, { status: 404 }))

  // If-None-Match short-circuit.
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch.replace(/^W\//, '').replace(/^"|"$/g, '') === head.httpEtag.replace(/^"|"$/g, '')) {
    return withCors(new Response(null, { status: 304, headers: buildHeaders(head, objectKey) }))
  }

  const body = await env.UPLOADS.get(objectKey)
  if (!body || !('body' in body)) {
    return withCors(json({ ok: false, error: 'not found' }, { status: 404 }))
  }

  const headers = buildHeaders(body, objectKey)
  headers.set('content-length', String(body.size))
  return withCors(new Response(request.method === 'HEAD' ? null : body.body, { status: 200, headers }))
}

function buildHeaders(object: R2Object, key: string): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.get('content-type')) headers.set('content-type', contentTypeForKey(key))
  if (!headers.get('cache-control')) headers.set('cache-control', 'public, max-age=86400, immutable')
  headers.set('accept-ranges', 'bytes')
  headers.set('etag', object.httpEtag)
  return headers
}

function pickExtension(contentType: string): string {
  switch (contentType) {
    case 'model/gltf-binary':
      return '.glb'
    case 'model/gltf+json':
      return '.gltf'
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/avif':
      return '.avif'
    case 'image/ktx2':
      return '.ktx2'
    case 'application/wasm':
      return '.wasm'
    default:
      return '.bin'
  }
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function randomBase62(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += BASE62[b % BASE62.length]
  return out
}

async function readBodyWithCap(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  // crypto.subtle.digest accepts BufferSource. Slice to guarantee a plain
  // ArrayBuffer (not a SharedArrayBuffer view).
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', ab)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
