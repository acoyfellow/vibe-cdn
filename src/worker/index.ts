import { BRAND_NAME, BRAND_VERSION, type HealthResponse } from '../shared/contracts'
import { estimateCost } from '../shared/pricing'
import type { Env } from './env'
import { LobbyDO } from './LobbyDO'
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

    if (url.pathname.startsWith('/assets/')) {
      return handleAssets(request, env, decodeURIComponent(url.pathname.slice('/assets/'.length)))
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
      '/install': '/install.html',
      '/docs': '/docs.html',
      '/embed': '/embed.html',
    }
    for (const [prefix, target] of Object.entries(pageMap)) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
        if (env.APP_ASSETS) {
          const assetUrl = new URL(request.url)
          assetUrl.pathname = target
          const assetReq = new Request(assetUrl.toString(), { method: 'GET', redirect: 'manual' })
          let res = await env.APP_ASSETS.fetch(assetReq)
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location')
            if (loc) {
              const followUrl = new URL(loc, assetUrl)
              res = await env.APP_ASSETS.fetch(new Request(followUrl.toString(), { method: 'GET' }))
            }
          }
          const headers = new Headers(res.headers)
          headers.set('cache-control', 'public, max-age=60')
          return new Response(res.body, { status: res.status, headers })
        }
      }
    }

    if (env.APP_ASSETS) return env.APP_ASSETS.fetch(request)
    return notFound()
  },
}
