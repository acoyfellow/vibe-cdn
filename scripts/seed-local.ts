#!/usr/bin/env bun
/**
 * Seed the local Worker's R2 bucket with the generated fixtures via the
 * dev-only `PUT /__dev/upload/:key` endpoint. The manifest is uploaded last
 * so that a fresh `/manifest.json` GET returns canonical data.
 *
 * Usage:
 *   bun scripts/seed-local.ts [--worker http://127.0.0.1:8787] [--skip-generate]
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { contentTypeForKey } from '../src/shared/mime'
import type { AssetManifest } from '../src/shared/contracts'
import { generateAll, type GeneratedFixture } from './gen-fixtures'

const EXTERNAL_ASSETS: { key: string; localPath: string; sourceUrl: string }[] = [
  {
    key: 'demo/car.glb',
    localPath: 'fixtures/external/ferrari.glb',
    sourceUrl: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/ferrari.glb',
  },
  {
    key: 'demo/helmet.glb',
    localPath: 'fixtures/external/DamagedHelmet.glb',
    sourceUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
  },
]

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_DIR = join(ROOT, 'fixtures', 'generated')
void ROOT // also used below

export type SeedOptions = {
  workerUrl: string
  skipGenerate?: boolean
}

export type SeedResult = {
  workerUrl: string
  uploads: { key: string; bytes: number; status: number }[]
  manifestStatus: number
}

export async function seedLocal(options: SeedOptions): Promise<SeedResult> {
  const fixtures: GeneratedFixture[] = options.skipGenerate ? await loadExisting() : await generateAll()

  // Add externally-fetched demo assets (Khronos Damaged Helmet etc).
  for (const ext of EXTERNAL_ASSETS) {
    const absLocal = resolve(ROOT, ext.localPath)
    if (!existsSync(absLocal)) {
      await mkdir(dirname(absLocal), { recursive: true })
      console.log(`fetching ${ext.key} ← ${ext.sourceUrl}`)
      const response = await fetch(ext.sourceUrl)
      if (!response.ok) {
        console.warn(`skip ${ext.key}: fetch failed (${response.status})`)
        continue
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      await writeFile(absLocal, bytes)
    }
    const bytes = await readFile(absLocal)
    fixtures.push({
      key: ext.key,
      path: absLocal,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: contentTypeForKey(ext.key),
    })
  }

  const uploads: SeedResult['uploads'] = []
  for (const f of fixtures) {
    const body = await readFile(f.path)
    const response = await fetch(`${options.workerUrl}/__dev/upload/${encodeURI(f.key)}`, {
      method: 'PUT',
      headers: {
        'content-type': f.contentType,
        'x-sha256': f.sha256,
      },
      body,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`upload failed for ${f.key}: ${response.status} ${response.statusText} ${text}`)
    }
    uploads.push({ key: f.key, bytes: f.bytes, status: response.status })
    console.log(`uploaded ${f.key.padEnd(20)} ${String(f.bytes).padStart(10)} bytes -> ${response.status}`)
  }

  // Upload a canonical __manifest.json that mirrors what the worker would build,
  // so /manifest.json returns immutable data.
  const manifest: AssetManifest = {
    generatedAt: new Date().toISOString(),
    assets: fixtures.map((f) => ({
      key: f.key,
      url: `/cdn/${f.key}`,
      contentType: f.contentType,
      bytes: f.bytes,
      sha256: f.sha256,
      immutable: true,
    })),
  }
  const manifestBody = JSON.stringify(manifest, null, 2)
  const manifestResponse = await fetch(`${options.workerUrl}/__dev/upload/__manifest.json`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: manifestBody,
  })
  if (!manifestResponse.ok) {
    const text = await manifestResponse.text().catch(() => '')
    throw new Error(`manifest upload failed: ${manifestResponse.status} ${manifestResponse.statusText} ${text}`)
  }
  console.log(`uploaded __manifest.json   ${String(manifestBody.length).padStart(10)} bytes -> ${manifestResponse.status}`)

  return { workerUrl: options.workerUrl, uploads, manifestStatus: manifestResponse.status }
}

async function loadExisting(): Promise<GeneratedFixture[]> {
  const manifestPath = join(OUT_DIR, 'manifest.json')
  const text = await readFile(manifestPath, 'utf8').catch(() => {
    throw new Error(`fixtures missing at ${manifestPath}; run gen-fixtures first or omit --skip-generate`)
  })
  const manifest = JSON.parse(text) as AssetManifest
  return manifest.assets.map((a) => ({
    key: a.key,
    path: join(OUT_DIR, a.key),
    bytes: a.bytes,
    sha256: a.sha256,
    contentType: a.contentType || contentTypeForKey(a.key),
  }))
}

function parseArgs(argv: string[]): SeedOptions {
  let workerUrl = process.env.WORKER_URL ?? 'http://127.0.0.1:4783'
  let skipGenerate = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--worker' || arg === '--worker-url') {
      const next = argv[++i]
      if (!next) throw new Error(`${arg} requires a value`)
      workerUrl = next
    } else if (arg?.startsWith('--worker=')) {
      workerUrl = arg.slice('--worker='.length)
    } else if (arg === '--skip-generate') {
      skipGenerate = true
    }
  }
  return { workerUrl: workerUrl.replace(/\/$/, ''), skipGenerate }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  console.log(`seeding worker at ${options.workerUrl}`)
  const result = await seedLocal(options)
  console.log(`done: ${result.uploads.length} assets + manifest -> ${options.workerUrl}`)
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
