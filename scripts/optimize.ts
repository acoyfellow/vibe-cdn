#!/usr/bin/env bun
/**
 * scripts/optimize.ts — glTF/GLB optimization pipeline.
 *
 * Usage:
 *   bun run optimize <inputPath> [--out <outDir>] [--no-draco] [--no-meshopt] [--no-ktx2]
 *
 * Per .glb file in `inputPath` (recursive when a directory is provided):
 *   1. read into a gltf-transform Document
 *   2. dedup → prune → instance → weld → simplify (light, error 0.001)
 *      → textureCompress (avif → webp fallback)
 *   3. optional Draco geometry compression (on by default)
 *   4. optional Meshopt compression (on by default)
 *   5. optional KTX2/BasisU texture compression (on by default if encoder available)
 *   6. write to <outDir>/<basename>.glb (default outDir: ./fixtures/optimized)
 *   7. content-address: also emit `<sha256>.glb` (copy) and a manifest.json
 *      with the original→hashed mapping
 *
 * Missing optional native deps (draco3dgltf, meshoptimizer, sharp, basis/ktx2
 * encoder) are detected at runtime; the affected stage is skipped with a
 * warning. The pipeline never throws because a backend is missing.
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type Document, NodeIO } from '@gltf-transform/core'
import {
  EXTMeshoptCompression,
  KHRDracoMeshCompression,
  KHRTextureBasisu,
} from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  instance,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

interface CliOptions {
  inputPath: string
  outDir: string
  draco: boolean
  meshopt: boolean
  ktx2: boolean
}

interface OptimizeResult {
  original: string
  output: string
  hashed: string
  sha256: string
  beforeBytes: number
  afterBytes: number
  ratio: number
}

interface Manifest {
  generatedAt: string
  entries: {
    original: string
    output: string
    hashed: string
    sha256: string
    beforeBytes: number
    afterBytes: number
    ratio: number
  }[]
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2)
  let inputPath: string | undefined
  let outDir: string | undefined
  let useDraco = true
  let useMeshopt = true
  let useKtx2 = true

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--out') {
      const v = args[++i]
      if (!v) throw new Error('--out requires a value')
      outDir = v
    } else if (a === '--no-draco') {
      useDraco = false
    } else if (a === '--no-meshopt') {
      useMeshopt = false
    } else if (a === '--no-ktx2') {
      useKtx2 = false
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else if (a && !a.startsWith('--') && !inputPath) {
      inputPath = a
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }

  if (!inputPath) {
    printHelp()
    throw new Error('inputPath is required')
  }

  return {
    inputPath: resolve(inputPath),
    outDir: resolve(outDir ?? join(ROOT, 'fixtures', 'optimized')),
    draco: useDraco,
    meshopt: useMeshopt,
    ktx2: useKtx2,
  }
}

function printHelp(): void {
  console.log(
    [
      'Usage: bun run optimize <inputPath> [--out <outDir>] [--no-draco] [--no-meshopt] [--no-ktx2]',
      '',
      '  inputPath   File or directory containing .glb files (directories scanned recursively).',
      '  --out       Output directory. Default: ./fixtures/optimized',
      '  --no-draco  Disable Draco geometry compression.',
      '  --no-meshopt  Disable Meshopt compression.',
      '  --no-ktx2   Disable KTX2/BasisU texture compression.',
    ].join('\n'),
  )
}

async function walkGlb(inputPath: string): Promise<string[]> {
  const info = await stat(inputPath)
  if (info.isFile()) {
    return extname(inputPath).toLowerCase() === '.glb' ? [inputPath] : []
  }
  const out: string[] = []
  const entries = await readdir(inputPath, { withFileTypes: true })
  for (const entry of entries) {
    const p = join(inputPath, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkGlb(p)))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.glb') {
      out.push(p)
    }
  }
  return out.sort()
}

/** Try to import an optional module by name. Returns null if unavailable. */
async function tryImport<T = unknown>(specifier: string): Promise<T | null> {
  try {
    return (await import(specifier)) as T
  } catch {
    return null
  }
}

interface SharpModule {
  default: unknown
}

interface Draco3dModule {
  default?: { createEncoderModule: () => Promise<unknown>; createDecoderModule: () => Promise<unknown> }
  createEncoderModule?: () => Promise<unknown>
  createDecoderModule?: () => Promise<unknown>
}

interface MeshoptModule {
  MeshoptSimplifier?: unknown
  MeshoptEncoder?: unknown
  default?: { MeshoptSimplifier?: unknown; MeshoptEncoder?: unknown }
}

/**
 * Resolve a per-run "backend" object: optional native helpers loaded once and
 * shared across files. Missing modules log a single warning each.
 */
interface Backends {
  sharp: unknown | null
  draco3d:
    | {
        encoder: unknown
        decoder: unknown
      }
    | null
  meshopt:
    | {
        simplifier: unknown
        encoder: unknown
      }
    | null
}

async function loadBackends(opts: CliOptions): Promise<Backends> {
  const sharpMod = await tryImport<SharpModule>('sharp')
  const sharp = sharpMod?.default ?? null
  if (!sharp) {
    console.warn('warn: `sharp` not installed; texture compression will use the fallback encoder.')
  }

  let draco3d: Backends['draco3d'] = null
  if (opts.draco) {
    const mod = await tryImport<Draco3dModule>('draco3dgltf')
    const base = mod?.default ?? mod
    const createEncoderModule = base?.createEncoderModule
    const createDecoderModule = base?.createDecoderModule
    if (createEncoderModule && createDecoderModule) {
      try {
        const encoder = await createEncoderModule()
        const decoder = await createDecoderModule()
        draco3d = { encoder, decoder }
      } catch (err) {
        console.warn(`warn: failed to initialize draco3dgltf (${(err as Error).message}); skipping Draco.`)
      }
    } else {
      console.warn('warn: `draco3dgltf` not installed; skipping Draco compression.')
    }
  }

  let meshoptBackend: Backends['meshopt'] = null
  if (opts.meshopt) {
    const mod = await tryImport<MeshoptModule>('meshoptimizer')
    const simplifier = mod?.MeshoptSimplifier ?? mod?.default?.MeshoptSimplifier ?? null
    const encoder = mod?.MeshoptEncoder ?? mod?.default?.MeshoptEncoder ?? null
    if (simplifier && encoder) {
      try {
        // Both expose a `ready` promise.
        const sReady = (simplifier as { ready?: Promise<unknown> }).ready
        const eReady = (encoder as { ready?: Promise<unknown> }).ready
        if (sReady) await sReady
        if (eReady) await eReady
        meshoptBackend = { simplifier, encoder }
      } catch (err) {
        console.warn(
          `warn: failed to initialize meshoptimizer (${(err as Error).message}); skipping Meshopt + simplify.`,
        )
      }
    } else {
      console.warn('warn: `meshoptimizer` not installed; skipping Meshopt + simplify stages.')
    }
  }

  return { sharp, draco3d, meshopt: meshoptBackend }
}

function makeIO(backends: Backends): NodeIO {
  const io = new NodeIO().registerExtensions([
    KHRDracoMeshCompression,
    EXTMeshoptCompression,
    KHRTextureBasisu,
  ])
  const deps: Record<string, unknown> = {}
  if (backends.draco3d) {
    deps['draco3d.encoder'] = backends.draco3d.encoder
    deps['draco3d.decoder'] = backends.draco3d.decoder
  }
  if (backends.meshopt) {
    deps['meshopt.encoder'] = backends.meshopt.encoder
    deps['meshopt.decoder'] = backends.meshopt.encoder
  }
  if (Object.keys(deps).length > 0) {
    io.registerDependencies(deps)
  }
  return io
}

async function applyPipeline(
  doc: Document,
  opts: CliOptions,
  backends: Backends,
): Promise<void> {
  await doc.transform(dedup(), prune(), instance({ min: 5 }), weld())

  if (backends.meshopt) {
    try {
      await doc.transform(simplify({ simplifier: backends.meshopt.simplifier, ratio: 0.0, error: 0.001 }))
    } catch (err) {
      console.warn(`warn: simplify failed (${(err as Error).message}); continuing.`)
    }
  }

  // textureCompress: try AVIF, then fall back to WebP if AVIF errors.
  // sharp may be null — gltf-transform will use its fallback encoder.
  try {
    await doc.transform(textureCompress({ encoder: backends.sharp ?? undefined, targetFormat: 'avif' }))
  } catch (err) {
    console.warn(
      `warn: AVIF textureCompress failed (${(err as Error).message}); retrying as WebP.`,
    )
    try {
      await doc.transform(textureCompress({ encoder: backends.sharp ?? undefined, targetFormat: 'webp' }))
    } catch (err2) {
      console.warn(`warn: WebP textureCompress failed (${(err2 as Error).message}); leaving textures untouched.`)
    }
  }

  if (opts.draco && backends.draco3d) {
    try {
      await doc.transform(draco({ method: 'edgebreaker' }))
    } catch (err) {
      console.warn(`warn: Draco transform failed (${(err as Error).message}); skipping.`)
    }
  }

  if (opts.meshopt && backends.meshopt) {
    try {
      await doc.transform(meshopt({ encoder: backends.meshopt.encoder, level: 'medium' }))
    } catch (err) {
      console.warn(`warn: Meshopt transform failed (${(err as Error).message}); skipping.`)
    }
  }

  if (opts.ktx2) {
    // KTX2/BasisU compression requires an external encoder (basisu / ktx-software)
    // that is not bundled with @gltf-transform/functions. The KHRTextureBasisu
    // extension is registered so existing KTX2 textures pass through; we warn
    // here because we do not invoke an external encoder.
    const hasKtx2 = doc
      .getRoot()
      .listTextures()
      .some((t) => t.getMimeType() === 'image/ktx2')
    if (!hasKtx2) {
      console.warn(
        'warn: KTX2 encoder not wired into this script; skipping KTX2 texture compression. ' +
          'Pass --no-ktx2 to silence.',
      )
    }
  }
}

async function optimizeFile(
  inputFile: string,
  opts: CliOptions,
  backends: Backends,
  io: NodeIO,
): Promise<OptimizeResult> {
  const beforeBytes = (await stat(inputFile)).size
  const doc = await io.read(inputFile)
  await applyPipeline(doc, opts, backends)

  const outBytes = await io.writeBinary(doc)
  const afterBytes = outBytes.byteLength
  const sha256 = createHash('sha256').update(outBytes).digest('hex')

  const outName = basename(inputFile)
  const outPath = join(opts.outDir, outName)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, outBytes)

  const hashedPath = join(opts.outDir, `${sha256}.glb`)
  // Use a real copy (not symlink) — keeps the file usable when served over R2/CDN.
  try {
    await unlink(hashedPath)
  } catch {
    // not present, ignore
  }
  await copyFile(outPath, hashedPath)

  return {
    original: inputFile,
    output: outPath,
    hashed: hashedPath,
    sha256,
    beforeBytes,
    afterBytes,
    ratio: beforeBytes === 0 ? 0 : afterBytes / beforeBytes,
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const opts = parseArgs(argv)
  const files = await walkGlb(opts.inputPath)
  if (files.length === 0) {
    console.error(`no .glb files found under ${opts.inputPath}`)
    process.exit(1)
  }

  await mkdir(opts.outDir, { recursive: true })
  const backends = await loadBackends(opts)
  const io = makeIO(backends)

  const results: OptimizeResult[] = []
  for (const f of files) {
    try {
      const r = await optimizeFile(f, opts, backends, io)
      results.push(r)
      const rel = relative(ROOT, f)
      const outRel = relative(ROOT, r.output)
      console.log(
        `${rel.padEnd(40)} ${formatBytes(r.beforeBytes).padStart(10)} → ${formatBytes(r.afterBytes).padStart(10)}  ` +
          `(${(r.ratio * 100).toFixed(1)}%)  → ${outRel}  sha256=${r.sha256.slice(0, 16)}…`,
      )
    } catch (err) {
      console.error(`error: failed to optimize ${f}: ${(err as Error).message}`)
    }
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    entries: results.map((r) => ({
      original: relative(ROOT, r.original),
      output: relative(ROOT, r.output),
      hashed: relative(ROOT, r.hashed),
      sha256: r.sha256,
      beforeBytes: r.beforeBytes,
      afterBytes: r.afterBytes,
      ratio: r.ratio,
    })),
  }
  const manifestPath = join(opts.outDir, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`wrote ${results.length} file(s) to ${relative(ROOT, opts.outDir)} (manifest: ${relative(ROOT, manifestPath)})`)
}

const invokedDirectly = (() => {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return pathToFileURL(resolve(argv1)).href === import.meta.url
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
