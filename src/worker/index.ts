import { BRAND_NAME, BRAND_VERSION, type HealthResponse } from '../shared/contracts'
import { estimateCost } from '../shared/pricing'
import type { Env } from './env'
import { LobbyDO } from './LobbyDO'
import { shouldFourOhFour } from '../shared/routing'
import { json, notFound } from './http'
import { handleAssets, handleDevUpload, handleManifest } from './routes/assets'
import { handleSave } from './routes/saves'
import { handleScores } from './routes/scores'
import { handleStats } from './routes/stats'
import { handlePublicGet, handleUpload } from './routes/uploads'

export { LobbyDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      const body: HealthResponse = {
        ok: true,
        name: BRAND_NAME,
        version: BRAND_VERSION,
        bindings: { r2: !!env.ASSETS, d1: !!env.DB, kv: !!env.SAVES, durableObjects: !!env.LOBBY },
      }
      return json(body)
    }

    if (url.pathname === '/manifest.json') return handleManifest(request, env)

    if (url.pathname.startsWith('/cdn/')) {
      return handleAssets(request, env, decodeURIComponent(url.pathname.slice('/cdn/'.length)))
    }

    if (url.pathname.startsWith('/__dev/upload/')) {
      return handleDevUpload(request, env, decodeURIComponent(url.pathname.slice('/__dev/upload/'.length)))
    }

    if (url.pathname === '/api/u' || url.pathname === '/api/u/') {
      return handleUpload(request, env)
    }

    if (url.pathname.startsWith('/u/')) {
      return handlePublicGet(request, env, decodeURIComponent(url.pathname.slice('/u/'.length)))
    }

    if (url.pathname === '/api/scores') return handleScores(request, env)

    const saveMatch = /^\/api\/saves\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (saveMatch) return handleSave(request, env, decodeURIComponent(saveMatch[1]), decodeURIComponent(saveMatch[2]))

    if (url.pathname === '/api/stats') return handleStats(request, env)

    if (url.pathname === '/api/cost/estimate') {
      const input = {
        bundleMb: Number(url.searchParams.get('bundleMb') ?? 150),
        monthlyPlayers: Number(url.searchParams.get('monthlyPlayers') ?? 10000),
        sessionsPerPlayer: Number(url.searchParams.get('sessionsPerPlayer') ?? 3),
        cacheHitRate: Number(url.searchParams.get('cacheHitRate') ?? 0.95),
        storageGb: Number(url.searchParams.get('storageGb') ?? 10),
      }
      return json({ ok: true, estimate: estimateCost(input) })
    }

    const lobbyMatch = /^\/ws\/lobby\/([^/]+)$/.exec(url.pathname)
    if (lobbyMatch) {
      const id = env.LOBBY.idFromName(decodeURIComponent(lobbyMatch[1]))
      return env.LOBBY.get(id).fetch(request)
    }

    // Pretty page routes. /demo, /install, /docs, /embed and their
    // subpaths all proxy a specific HTML bundle. Fetching the asset
    // through APP_ASSETS sometimes triggers an internal trailing-slash
    // redirect; we follow it once and rewrap so the user only sees 200.
    const pageMap: Record<string, string> = {
      '/demo': '/demo.html',
      '/demo2': '/demo2.html',
      '/install': '/install.html',
      '/docs': '/docs.html',
      '/embed': '/embed.html',
    }
    for (const [prefix, target] of Object.entries(pageMap)) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
        if (env.APP_ASSETS) {
          // Map the pretty path to the canonical extensionless asset path.
          // The assets binding serves /embed.html at /embed (it strips the
          // .html and 307s). So we request the extensionless form directly
          // and let the binding resolve it. We also send a NON-navigate
          // request: a browser iframe sends `Sec-Fetch-Mode: navigate`,
          // which makes the SPA `not_found_handling` serve index.html
          // (the homepage) for any path it doesn't recognize. By issuing
          // our own bare GET (no Sec-Fetch headers) and pointing at the
          // exact extensionless asset, we get the right page every time.
          // wrangler `run_worker_first` ensures this code runs before the
          // assets binding's SPA fallback. We fetch the literal .html file;
          // the binding may 307 it to the extensionless form, which we
          // follow, landing on the right page content.
          const assetUrl = new URL(request.url)
          assetUrl.pathname = target
          assetUrl.search = ''
          const res = await env.APP_ASSETS.fetch(
            new Request(assetUrl.toString(), { method: 'GET', redirect: 'follow' }),
          )
          const headers = new Headers(res.headers)
          headers.set('cache-control', 'public, max-age=60')
          headers.set('content-type', 'text/html; charset=utf-8')
          return new Response(res.body, { status: res.status, headers })
        }
      }
    }

    if (env.APP_ASSETS) {
      const res = await env.APP_ASSETS.fetch(request)
      const servedTheSpaShell = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
      if (res.status === 200 && shouldFourOhFour(url.pathname) && servedTheSpaShell) {
        return notFound(`no such asset: ${url.pathname}`)
      }
      return res
    }
    return notFound()
  },
}
