#!/usr/bin/env bun
/**
 * Orchestrate the local quick-start demo:
 *   1. Apply D1 migrations against the local persisted state.
 *   2. Start `wrangler dev` (worker on :8787) in the background.
 *   3. Poll /health until ready.
 *   4. Generate fixtures and seed R2/KV/manifest.
 *   5. Start `vite` (app on :5374) in the background.
 *   6. Print the demo URL and optionally open the browser.
 *
 * Flags:
 *   --no-open         do not auto-open the browser
 *   --worker-port N   override worker port (default 8787)
 *   --app-port N      override vite port (default 5374)
 *   --skip-migrate    skip d1 migrations
 *   --skip-seed       skip fixture generation + seeding
 *   --skip-app        do not start vite (worker-only demo)
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { seedLocal } from './seed-local'

type DemoOptions = {
  open: boolean
  workerPort: number
  appPort: number
  skipMigrate: boolean
  skipSeed: boolean
  skipApp: boolean
}

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const children: ChildProcess[] = []
let shuttingDown = false

function parseArgs(argv: string[]): DemoOptions {
  const opt: DemoOptions = {
    open: true,
    workerPort: 4783,
    appPort: 5374,
    skipMigrate: false,
    skipSeed: false,
    skipApp: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-open') opt.open = false
    else if (arg === '--open') opt.open = true
    else if (arg === '--skip-migrate') opt.skipMigrate = true
    else if (arg === '--skip-seed') opt.skipSeed = true
    else if (arg === '--skip-app' || arg === '--worker-only') opt.skipApp = true
    else if (arg === '--worker-port') {
      const next = argv[++i]
      if (next) opt.workerPort = Number(next)
    } else if (arg?.startsWith('--worker-port=')) {
      opt.workerPort = Number(arg.slice('--worker-port='.length))
    } else if (arg === '--app-port') {
      const next = argv[++i]
      if (next) opt.appPort = Number(next)
    } else if (arg?.startsWith('--app-port=')) {
      opt.appPort = Number(arg.slice('--app-port='.length))
    }
  }
  return opt
}

function migrate(): void {
  console.log('• applying D1 migrations (local)…')
  const result = spawnSync(
    'wrangler',
    ['d1', 'migrations', 'apply', 'vibe-cdn-db', '--local', '--persist-to', '.wrangler/state'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: '1' } },
  )
  if (result.status !== 0) {
    throw new Error(`d1 migrate exited with status ${result.status}`)
  }
}

function startWorker(port: number): ChildProcess {
  console.log(`• starting wrangler dev on :${port}…`)
  const child = spawn(
    'wrangler',
    ['dev', '--local', '--persist-to', '.wrangler/state', '--port', String(port), '--ip', '127.0.0.1'],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
  )
  children.push(child)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`wrangler dev exited unexpectedly (code=${code} signal=${signal ?? 'none'})`)
      shutdown(code ?? 1)
    }
  })
  return child
}

function startApp(port: number): ChildProcess {
  console.log(`• starting vite on :${port}…`)
  const child = spawn('vite', ['--host', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  })
  children.push(child)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`vite exited unexpectedly (code=${code} signal=${signal ?? 'none'})`)
      shutdown(code ?? 1)
    }
  })
  return child
}

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  while (Date.now() < deadline) {
    attempt++
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
        if (body?.ok === true) {
          console.log(`• worker healthy after ${attempt} attempts`)
          return
        }
      }
    } catch {
      // not ready yet
    }
    await delay(500)
  }
  throw new Error(`worker did not become healthy within ${timeoutMs}ms at ${url}`)
}

async function waitForPort(host: string, port: number, timeoutMs = 30_000): Promise<void> {
  const url = `http://${host}:${port}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      // Any HTTP response indicates the port is listening.
      if (response.status >= 100) return
    } catch {
      // not yet
    }
    await delay(300)
  }
  throw new Error(`port ${host}:${port} did not open within ${timeoutMs}ms`)
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.unref()
  } catch (err) {
    console.warn(`could not open browser: ${String(err)}`)
  }
}

function shutdown(code: number): void {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
  }
  setTimeout(() => process.exit(code), 250).unref()
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const workerUrl = `http://127.0.0.1:${options.workerPort}`

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  if (!options.skipMigrate) migrate()

  startWorker(options.workerPort)
  await waitForHealth(workerUrl, 90_000)

  if (!options.skipSeed) {
    console.log('• seeding fixtures…')
    await seedLocal({ workerUrl })
  } else {
    console.log('• skipping seed (per --skip-seed)')
  }

  if (!options.skipApp) {
    startApp(options.appPort)
    await waitForPort('127.0.0.1', options.appPort, 60_000)
  }

  const appUrl = options.skipApp ? workerUrl : `http://127.0.0.1:${options.appPort}`
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  vibe-cdn ready`)
  console.log(`  worker : ${workerUrl}`)
  if (!options.skipApp) console.log(`  app    : ${appUrl}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')

  if (options.open) openBrowser(appUrl)

  // Keep the process alive until child processes exit or the user Ctrl-Cs.
  await new Promise<void>(() => {})
}

main().catch((err) => {
  console.error(err)
  shutdown(1)
})
