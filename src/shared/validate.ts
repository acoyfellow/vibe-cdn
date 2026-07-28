export const MAX_NAME_LEN = 24
export const MAX_SCORE = 1_000_000_000
export const MAX_SAVE_BYTES = 64 * 1024
export const MAX_KEY_LEN = 64

export type Valid<T> = { ok: true; value: T }
export type Invalid = { ok: false; error: string }
export type Result<T> = Valid<T> | Invalid

export function validateScore(raw: unknown): Result<number> {
  if (typeof raw === 'boolean' || Array.isArray(raw) || (raw !== null && typeof raw === 'object')) {
    return { ok: false, error: 'score must be a number' }
  }
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'score is required' }
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false, error: 'score must be a finite number' }
  if (n < 0) return { ok: false, error: 'score must not be negative' }
  if (n > MAX_SCORE) return { ok: false, error: 'score is out of range' }
  return { ok: true, value: Math.floor(n) }
}

export function validateName(raw: unknown): Result<string> {
  if (raw === null || raw === undefined) return { ok: true, value: 'player' }
  if (typeof raw !== 'string') return { ok: false, error: 'name must be a string' }
  const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (trimmed.length === 0) return { ok: true, value: 'player' }
  return { ok: true, value: trimmed.slice(0, MAX_NAME_LEN) }
}

export function validateSaveKey(raw: string): Result<string> {
  if (raw.length === 0) return { ok: false, error: 'key must not be empty' }
  if (raw.length > MAX_KEY_LEN) return { ok: false, error: 'key is too long' }
  if (!/^[A-Za-z0-9._:-]+$/.test(raw)) return { ok: false, error: 'key has invalid characters' }
  return { ok: true, value: raw }
}

export function validateSaveBody(text: string): Result<string> {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_SAVE_BYTES) return { ok: false, error: 'save body is too large' }
  try {
    JSON.parse(text)
  } catch {
    return { ok: false, error: 'save body must be valid JSON' }
  }
  return { ok: true, value: text }
}
