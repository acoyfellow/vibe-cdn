export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(value, null, 2), { ...init, headers })
}

export function corsHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, range, if-none-match',
    'access-control-expose-headers': 'accept-ranges, content-range, content-length, content-type, etag, cache-control',
  })
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of corsHeaders()) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function notFound(message = 'not found'): Response {
  return json({ ok: false, error: message }, { status: 404 })
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new Error('expected JSON body')
  }
}
