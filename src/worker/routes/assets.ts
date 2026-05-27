import { contentTypeForKey } from '../../shared/mime'
import type { AssetManifest } from '../../shared/contracts'
import type { Env } from '../env'
import { corsHeaders, json, withCors } from '../http'

const IMMUTABLE = 'public, max-age=31536000, immutable'

type ParsedRange =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'range'; r2: R2Range }

export async function handleAssets(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withCors(json({ ok: false, error: 'method not allowed' }, { status: 405 }))
  }
  if (!key) return withCors(json({ ok: false, error: 'asset key required' }, { status: 400 }))

  // 1. Parse Range header up-front. Malformed header => 400.
  const rangeHeader = request.headers.get('range')
  const parsed = parseRange(rangeHeader)
  if (parsed.kind === 'invalid') {
    return withCors(json({ ok: false, error: 'invalid range header' }, { status: 400 }))
  }

  // 2. HEAD-style metadata fetch so we can answer 304/416/HEAD without body cost.
  const meta = await env.ASSETS.head(key)
  if (!meta) return withCors(json({ ok: false, error: `asset not found: ${key}` }, { status: 404 }))

  // 3. If-None-Match short-circuit. RFC 7232: match against current ETag.
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && etagMatches(ifNoneMatch, meta.httpEtag)) {
    return withCors(new Response(null, { status: 304, headers: objectHeaders(meta, key) }))
  }

  const size = meta.size

  // 4. Resolve range against size, possibly unsatisfiable => 416.
  let resolvedOffset = 0
  let resolvedLength = size
  if (parsed.kind === 'range') {
    const r = resolveRange(parsed.r2, size)
    if (!r) {
      const headers = objectHeaders(meta, key)
      headers.set('content-range', `bytes */${size}`)
      headers.delete('content-length')
      return withCors(new Response(null, { status: 416, headers }))
    }
    resolvedOffset = r.offset
    resolvedLength = r.length
  }

  // 5. HEAD: never fetch the body.
  if (request.method === 'HEAD') {
    const headers = objectHeaders(meta, key)
    if (parsed.kind === 'range') {
      const end = resolvedOffset + resolvedLength - 1
      headers.set('content-range', `bytes ${resolvedOffset}-${end}/${size}`)
      headers.set('content-length', String(resolvedLength))
      return withCors(new Response(null, { status: 206, headers }))
    }
    headers.set('content-length', String(size))
    return withCors(new Response(null, { status: 200, headers }))
  }

  // 6. GET. For ranged requests pass an R2Range with resolved bounds so we don't
  // depend on R2's own clamping behaviour for suffix ranges.
  const body =
    parsed.kind === 'range'
      ? await env.ASSETS.get(key, { range: { offset: resolvedOffset, length: resolvedLength } })
      : await env.ASSETS.get(key)

  if (!body) return withCors(json({ ok: false, error: `asset not found: ${key}` }, { status: 404 }))
  if (!isObjectBody(body)) {
    // Should not happen without onlyIf, but stay defensive.
    return withCors(new Response(null, { status: 304, headers: objectHeaders(body, key) }))
  }

  const headers = objectHeaders(body, key)
  if (parsed.kind === 'range') {
    const end = resolvedOffset + resolvedLength - 1
    headers.set('content-range', `bytes ${resolvedOffset}-${end}/${size}`)
    headers.set('content-length', String(resolvedLength))
    return withCors(new Response(body.body, { status: 206, headers }))
  }

  headers.set('content-length', String(size))
  return withCors(new Response(body.body, { status: 200, headers }))
}

export async function handleManifest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withCors(json({ ok: false, error: 'method not allowed' }, { status: 405 }))
  }

  const manifestObject = await env.ASSETS.get('__manifest.json')
  if (manifestObject && isObjectBody(manifestObject)) {
    const text = await manifestObject.text()
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      etag: manifestObject.httpEtag,
    })
    return withCors(new Response(request.method === 'HEAD' ? null : text, { headers }))
  }

  const list = await env.ASSETS.list({ limit: 1000 })
  const manifest: AssetManifest = {
    generatedAt: new Date().toISOString(),
    assets: list.objects
      .filter((object) => object.key !== '__manifest.json')
      .map((object) => ({
        key: object.key,
        url: `/assets/${object.key}`,
        contentType: object.customMetadata?.contentType ?? contentTypeForKey(object.key),
        bytes: object.size,
        sha256: object.customMetadata?.sha256 ?? '',
        immutable: true,
      })),
  }
  return withCors(json(manifest, { headers: { 'cache-control': 'no-cache' } }))
}

export async function handleDevUpload(request: Request, env: Env, key: string): Promise<Response> {
  if (env.ALLOW_DEV_UPLOADS !== 'true') return json({ ok: false, error: 'dev uploads disabled' }, { status: 403 })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (request.method !== 'PUT') return withCors(json({ ok: false, error: 'method not allowed' }, { status: 405 }))
  const body = await request.arrayBuffer()
  const contentType = request.headers.get('content-type') ?? contentTypeForKey(key)
  const sha256 = request.headers.get('x-sha256') ?? ''
  await env.ASSETS.put(key, body, {
    httpMetadata: { contentType, cacheControl: IMMUTABLE },
    customMetadata: { contentType, sha256 },
  })
  return withCors(json({ ok: true, key, bytes: body.byteLength, contentType, sha256 }))
}

function objectHeaders(object: R2Object, key: string): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.get('content-type')) headers.set('content-type', contentTypeForKey(key))
  if (!headers.get('cache-control')) headers.set('cache-control', IMMUTABLE)
  headers.set('accept-ranges', 'bytes')
  headers.set('etag', object.httpEtag)
  return headers
}

function isObjectBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return 'body' in object
}

function etagMatches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true
  // Strip optional weak prefix and quotes on both sides for comparison.
  const norm = (v: string) => v.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  const target = norm(etag)
  return ifNoneMatch
    .split(',')
    .map((part) => norm(part))
    .some((part) => part === target)
}

function parseRange(range: string | null): ParsedRange {
  if (!range) return { kind: 'none' }
  // Only single-range "bytes=..." is supported. Reject multi-range and other units.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return { kind: 'invalid' }
  const startStr = match[1]
  const endStr = match[2]
  const hasStart = startStr.length > 0
  const hasEnd = endStr.length > 0
  if (!hasStart && !hasEnd) return { kind: 'invalid' }
  if (hasStart && hasEnd) {
    const start = Number(startStr)
    const end = Number(endStr)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'invalid' }
    if (end < start) return { kind: 'range', r2: { offset: start, length: 0 } }
    return { kind: 'range', r2: { offset: start, length: end - start + 1 } }
  }
  if (hasStart) {
    const start = Number(startStr)
    if (!Number.isFinite(start)) return { kind: 'invalid' }
    return { kind: 'range', r2: { offset: start } }
  }
  // suffix range: bytes=-N => last N bytes
  const suffix = Number(endStr)
  if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'invalid' }
  return { kind: 'range', r2: { suffix } }
}

// Resolve a parsed R2Range against the known object size. Returns absolute
// offset/length in bytes, or null if the range is unsatisfiable (=> 416).
function resolveRange(r: R2Range, size: number): { offset: number; length: number } | null {
  if ('suffix' in r) {
    if (size === 0) return null
    const length = Math.min(r.suffix, size)
    if (length <= 0) return null
    return { offset: size - length, length }
  }
  const offset = r.offset ?? 0
  if (offset >= size) return null
  if (offset < 0) return null
  if ('length' in r && typeof r.length === 'number') {
    const length = Math.min(r.length, size - offset)
    if (length <= 0) return null
    return { offset, length }
  }
  return { offset, length: size - offset }
}
