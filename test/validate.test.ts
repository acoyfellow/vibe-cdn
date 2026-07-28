import { describe, expect, test } from 'bun:test'
import {
  MAX_KEY_LEN,
  MAX_NAME_LEN,
  MAX_SAVE_BYTES,
  MAX_SCORE,
  validateName,
  validateSaveBody,
  validateSaveKey,
  validateScore,
} from '../src/shared/validate'

describe('validateScore (AT1: NaN reached the D1 INSERT)', () => {
  test('accepts a plain integer', () => {
    expect(validateScore(1234)).toEqual({ ok: true, value: 1234 })
  })

  test('accepts a numeric string', () => {
    expect(validateScore('1234')).toEqual({ ok: true, value: 1234 })
  })

  test('floors a fractional score', () => {
    expect(validateScore(12.9)).toEqual({ ok: true, value: 12 })
  })

  test('accepts zero', () => {
    expect(validateScore(0)).toEqual({ ok: true, value: 0 })
  })

  const poison: [string, unknown][] = [
    ['non-numeric string', 'abc'],
    ['partly numeric string', '12abc'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['1e999 overflow string', '1e999'],
    ['object', {}],
    ['array', []],
    ['true', true],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['negative', -5],
    ['above max', MAX_SCORE + 1],
  ]

  for (const [label, value] of poison) {
    test(`rejects ${label}`, () => {
      const result = validateScore(value)
      expect(result.ok).toBe(false)
    })
  }

  test('every accepted score is a finite non-negative integer', () => {
    for (const [, value] of poison) {
      const result = validateScore(value)
      if (result.ok) {
        expect(Number.isFinite(result.value)).toBe(true)
        expect(Number.isInteger(result.value)).toBe(true)
        expect(result.value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('the OLD sanitizer really did produce NaN (regression witness)', () => {
    const old = (raw: unknown) => Math.max(0, Math.floor(Number(raw ?? 0)))
    expect(Number.isNaN(old('abc'))).toBe(true)
    expect(old('1e999')).toBe(Number.POSITIVE_INFINITY)
    expect(validateScore('abc').ok).toBe(false)
    expect(validateScore('1e999').ok).toBe(false)
  })
})

describe('validateName', () => {
  test('defaults a missing name', () => {
    expect(validateName(undefined)).toEqual({ ok: true, value: 'player' })
    expect(validateName(null)).toEqual({ ok: true, value: 'player' })
  })

  test('defaults a whitespace-only name', () => {
    expect(validateName('   ')).toEqual({ ok: true, value: 'player' })
  })

  test('truncates an over-long name', () => {
    const result = validateName('x'.repeat(500))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.length).toBe(MAX_NAME_LEN)
  })

  test('strips control characters', () => {
    const result = validateName('ab\u0000\u001fcd')
    expect(result).toEqual({ ok: true, value: 'abcd' })
  })

  test('rejects a non-string name', () => {
    expect(validateName(42).ok).toBe(false)
    expect(validateName({}).ok).toBe(false)
  })

  test('keeps a normal name intact', () => {
    expect(validateName('Jordan')).toEqual({ ok: true, value: 'Jordan' })
  })
})

describe('validateSaveKey (AT3: unbounded player/slot path params)', () => {
  test('accepts a normal key', () => {
    expect(validateSaveKey('player-1')).toEqual({ ok: true, value: 'player-1' })
  })

  test('rejects an empty key', () => {
    expect(validateSaveKey('').ok).toBe(false)
  })

  test('rejects an over-long key', () => {
    expect(validateSaveKey('x'.repeat(MAX_KEY_LEN + 1)).ok).toBe(false)
  })

  test('accepts a key at exactly the limit', () => {
    expect(validateSaveKey('x'.repeat(MAX_KEY_LEN)).ok).toBe(true)
  })

  test('rejects path traversal and separators', () => {
    expect(validateSaveKey('../../etc/passwd').ok).toBe(false)
    expect(validateSaveKey('a/b').ok).toBe(false)
  })

  test('rejects whitespace and control characters', () => {
    expect(validateSaveKey('a b').ok).toBe(false)
    expect(validateSaveKey('a\nb').ok).toBe(false)
  })
})

describe('validateSaveBody (AT3: no size cap, uncaught JSON.parse)', () => {
  test('accepts a small JSON object', () => {
    expect(validateSaveBody('{"level":3}')).toEqual({ ok: true, value: '{"level":3}' })
  })

  test('preserves bytes exactly for round-trip fidelity', () => {
    const text = '{"a":1,  "b":  [1,2,3]}'
    const result = validateSaveBody(text)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(text)
  })

  test('rejects invalid JSON rather than throwing (was an uncaught 500)', () => {
    expect(() => validateSaveBody('{not json')).not.toThrow()
    expect(validateSaveBody('{not json').ok).toBe(false)
  })

  test('rejects an empty body', () => {
    expect(validateSaveBody('').ok).toBe(false)
  })

  test('rejects an oversized body', () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(MAX_SAVE_BYTES) })
    expect(validateSaveBody(huge).ok).toBe(false)
  })

  test('accepts a body just under the cap', () => {
    const pad = MAX_SAVE_BYTES - 32
    const body = JSON.stringify({ blob: 'x'.repeat(pad) })
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(MAX_SAVE_BYTES)
    expect(validateSaveBody(body).ok).toBe(true)
  })

  test('counts BYTES not characters for multi-byte input', () => {
    const emoji = '\u{1f600}'
    const body = JSON.stringify({ blob: emoji.repeat(MAX_SAVE_BYTES / 4) })
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(MAX_SAVE_BYTES)
    expect(validateSaveBody(body).ok).toBe(false)
  })
})
