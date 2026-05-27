#!/usr/bin/env bun
/**
 * Generate deterministic local fixtures for the vibe-cdn demo.
 *
 *  fixtures/generated/demo/triangle.glb - a tiny but valid binary glTF (single triangle)
 *  fixtures/generated/demo/large.bin    - ~8 MiB deterministic binary blob (PRNG seeded)
 *  fixtures/generated/manifest.json - asset manifest matching shared/contracts.ts
 *
 * No third-party deps are required: the GLB is hand-built per the glTF 2.0
 * binary container spec (12-byte header + JSON chunk + BIN chunk, both
 * padded to a 4-byte boundary).
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { contentTypeForKey } from '../src/shared/mime'
import type { AssetManifest, AssetManifestEntry } from '../src/shared/contracts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = join(ROOT, 'fixtures', 'generated')

const LARGE_BYTES = 8 * 1024 * 1024 // 8 MiB

export type GeneratedFixture = {
  key: string
  path: string
  bytes: number
  sha256: string
  contentType: string
}

export async function generateAll(): Promise<GeneratedFixture[]> {
  await mkdir(OUT_DIR, { recursive: true })

  const glb = buildTinyGlb()
  const large = buildLargeBinary(LARGE_BYTES, 0xc0ffee)

  const fixtures: GeneratedFixture[] = []
  fixtures.push(await writeFixture('demo/triangle.glb', glb))
  fixtures.push(await writeFixture('demo/large.bin', large))

  const manifest: AssetManifest = {
    generatedAt: new Date().toISOString(),
    assets: fixtures.map(
      (f): AssetManifestEntry => ({
        key: f.key,
        url: `/assets/${f.key}`,
        contentType: f.contentType,
        bytes: f.bytes,
        sha256: f.sha256,
        immutable: true,
      }),
    ),
  }
  const manifestPath = join(OUT_DIR, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return fixtures
}

async function writeFixture(key: string, data: Uint8Array): Promise<GeneratedFixture> {
  const path = join(OUT_DIR, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
  const sha256 = createHash('sha256').update(data).digest('hex')
  return {
    key,
    path,
    bytes: data.byteLength,
    sha256,
    contentType: contentTypeForKey(key),
  }
}

/**
 * Build a tiny but spec-valid GLB containing a single triangle as a POSITION
 * accessor. The JSON chunk references one buffer view into the BIN chunk.
 */
export function buildTinyGlb(): Uint8Array {
  // Three vec3 float positions: (0,0,0), (1,0,0), (0,1,0). 36 bytes.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const bin = new Uint8Array(positions.buffer)
  const binPadded = padTo4(bin, 0x00)

  const gltf = {
    asset: { version: '2.0', generator: 'vibe-cdn/gen-fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, mode: 4 }],
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPadded = padTo4(jsonBytes, 0x20)

  const totalLength = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength
  const out = new Uint8Array(totalLength)
  const view = new DataView(out.buffer)

  // Header
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true) // version
  view.setUint32(8, totalLength, true)

  // JSON chunk
  let offset = 12
  view.setUint32(offset, jsonPadded.byteLength, true)
  view.setUint32(offset + 4, 0x4e4f534a, true) // 'JSON'
  out.set(jsonPadded, offset + 8)
  offset += 8 + jsonPadded.byteLength

  // BIN chunk
  view.setUint32(offset, binPadded.byteLength, true)
  view.setUint32(offset + 4, 0x004e4942, true) // 'BIN\0'
  out.set(binPadded, offset + 8)

  return out
}

function padTo4(data: Uint8Array, fill: number): Uint8Array {
  const pad = (4 - (data.byteLength % 4)) % 4
  if (pad === 0) return data
  const padded = new Uint8Array(data.byteLength + pad)
  padded.set(data, 0)
  padded.fill(fill, data.byteLength)
  return padded
}

/**
 * Deterministic xorshift32 pseudo-random fill. Same seed always produces the
 * same bytes so the fixture is reproducible.
 */
export function buildLargeBinary(byteLength: number, seed: number): Uint8Array {
  const out = new Uint8Array(byteLength)
  let state = seed >>> 0
  // Avoid the all-zero state which xorshift gets stuck on.
  if (state === 0) state = 0x1
  const view = new DataView(out.buffer)
  for (let i = 0; i + 4 <= byteLength; i += 4) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    view.setUint32(i, state >>> 0, true)
  }
  // Tail bytes (only matters if byteLength % 4 !== 0; 8 MiB is aligned so skipped).
  for (let i = byteLength - (byteLength % 4); i < byteLength; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    out[i] = state & 0xff
  }
  return out
}

async function main(): Promise<void> {
  const fixtures = await generateAll()
  for (const f of fixtures) {
    console.log(`fixture: ${f.key.padEnd(20)} ${String(f.bytes).padStart(10)} bytes  sha256=${f.sha256.slice(0, 16)}…`)
  }
  console.log(`wrote ${fixtures.length} fixtures to ${OUT_DIR}`)
}

const invokedDirectly = (() => {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return resolve(argv1) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
