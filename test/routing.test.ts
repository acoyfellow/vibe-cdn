import { describe, expect, test } from 'bun:test'
import { pathExtension, shouldFourOhFour } from '../src/shared/routing'

describe('pathExtension', () => {
  test('reads a simple extension', () => {
    expect(pathExtension('/assets/car.glb')).toBe('glb')
  })
  test('is case-insensitive', () => {
    expect(pathExtension('/A/B/CAR.GLB')).toBe('glb')
  })
  test('takes the LAST extension of a multi-dot name', () => {
    expect(pathExtension('/assets/car.draco.glb')).toBe('glb')
    expect(pathExtension('/x/bundle.js.map')).toBe('map')
  })
  test('no extension for bare and trailing-slash paths', () => {
    expect(pathExtension('/docs')).toBeUndefined()
    expect(pathExtension('/docs/')).toBeUndefined()
    expect(pathExtension('/')).toBeUndefined()
  })
  test('a dotfile is not an extension', () => {
    expect(pathExtension('/.env')).toBeUndefined()
  })
  test('a trailing dot is not an extension', () => {
    expect(pathExtension('/weird.')).toBeUndefined()
  })
})

describe('shouldFourOhFour (SPA fallback must not swallow asset 404s)', () => {
  test('asset-looking paths get an honest 404', () => {
    for (const p of [
      '/assets/missing.glb',
      '/models/x.gltf',
      '/physics.wasm',
      '/manifest-nope.json',
      '/sprites/hero.png',
      '/audio/hit.mp3',
      '/bundle.js',
      '/style.css',
      '/tex.ktx2',
      '/data.bin',
    ]) {
      expect(shouldFourOhFour(p)).toBe(true)
    }
  })

  test('real SPA routes still fall through to the shell', () => {
    for (const p of ['/', '/docs', '/docs/deep/link', '/demo2', '/embed/arena', '/install']) {
      expect(shouldFourOhFour(p)).toBe(false)
    }
  })

  test('explicit .html is a page, not an asset 404', () => {
    expect(shouldFourOhFour('/demo2.html')).toBe(false)
    expect(shouldFourOhFour('/index.htm')).toBe(false)
  })

  test('an unknown extension is treated as a route, not an asset', () => {
    expect(shouldFourOhFour('/some/page.php')).toBe(false)
    expect(shouldFourOhFour('/v1.2')).toBe(false)
  })

  test('the exact case the probe caught: a missing .glb', () => {
    expect(shouldFourOhFour('/assets/definitely-not-here-123.glb')).toBe(true)
  })
})
