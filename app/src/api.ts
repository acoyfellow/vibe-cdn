// Tiny fetch helpers. All paths are same-origin and proxied by Vite to the worker.

export type FetchResult<T> = {
  ok: boolean
  status: number
  ms: number
  data?: T
  error?: string
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<FetchResult<T>> {
  const start = performance.now()
  try {
    const res = await fetch(path, init)
    const ms = Math.round(performance.now() - start)
    let data: T | undefined
    let error: string | undefined
    const text = await res.text()
    if (text) {
      try {
        data = JSON.parse(text) as T
      } catch {
        error = `non-json response (${text.slice(0, 80)})`
      }
    }
    return { ok: res.ok, status: res.status, ms, data, error }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function putJson<T>(path: string, body: unknown): Promise<FetchResult<T>> {
  return getJson<T>(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function postJson<T>(path: string, body: unknown): Promise<FetchResult<T>> {
  return getJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type RangeResult = {
  ok: boolean
  status: number
  ms: number
  bytes: number
  acceptRanges: string | null
  contentRange: string | null
  cacheStatus: string | null
  cfRay: string | null
  age: string | null
  error?: string
}

export async function fetchRange(path: string, start: number, end: number): Promise<RangeResult> {
  const t0 = performance.now()
  try {
    const res = await fetch(path, { headers: { range: `bytes=${start}-${end}` } })
    let bytes = 0
    if (res.body) {
      const reader = res.body.getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) bytes += value.byteLength
      }
    }
    return {
      ok: res.ok || res.status === 206,
      status: res.status,
      ms: Math.round(performance.now() - t0),
      bytes,
      acceptRanges: res.headers.get('accept-ranges'),
      contentRange: res.headers.get('content-range'),
      cacheStatus: res.headers.get('cf-cache-status'),
      cfRay: res.headers.get('cf-ray'),
      age: res.headers.get('age'),
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - t0),
      bytes: 0,
      acceptRanges: null,
      contentRange: null,
      cacheStatus: null,
      cfRay: null,
      age: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
