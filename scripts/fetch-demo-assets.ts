#!/usr/bin/env bun
/**
 * Fetch external demo assets that we do not commit to the repo.
 * Runs idempotently — if the file already exists, skips the download.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

type AssetSpec = { path: string; url: string }

const ASSETS: AssetSpec[] = [
  {
    path: 'fixtures/external/DamagedHelmet.glb',
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
  },
]

async function main(): Promise<void> {
  for (const asset of ASSETS) {
    const localPath = resolve(ROOT, asset.path)
    if (existsSync(localPath)) {
      console.log(`exists  ${asset.path}`)
      continue
    }
    await mkdir(dirname(localPath), { recursive: true })
    console.log(`fetch   ${asset.path} ← ${asset.url}`)
    const response = await fetch(asset.url)
    if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`)
    const body = new Uint8Array(await response.arrayBuffer())
    await writeFile(localPath, body)
    console.log(`wrote   ${asset.path} (${body.byteLength.toLocaleString()} bytes)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
