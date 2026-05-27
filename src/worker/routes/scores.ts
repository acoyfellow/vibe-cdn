import type { Env } from '../env'
import { json, readJson } from '../http'

type ScoreBody = { name?: string; score?: number }

export async function handleScores(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, name, score, created_at AS createdAt FROM scores ORDER BY score DESC, created_at ASC LIMIT 25').all()
    return json({ ok: true, scores: rows.results ?? [] })
  }

  if (request.method === 'POST') {
    const body = await readJson<ScoreBody>(request)
    const name = String(body.name ?? 'player').slice(0, 24)
    const score = Math.max(0, Math.floor(Number(body.score ?? 0)))
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await env.DB.prepare('INSERT INTO scores (id, name, score, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, score, createdAt)
      .run()
    return json({ ok: true, score: { id, name, score, createdAt } })
  }

  return json({ ok: false, error: 'method not allowed' }, { status: 405 })
}
