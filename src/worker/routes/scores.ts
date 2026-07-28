import { validateName, validateScore } from '../../shared/validate'
import type { Env } from '../env'
import { json, readJson } from '../http'

type ScoreBody = { name?: unknown; score?: unknown }

export async function handleScores(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, name, score, created_at AS createdAt FROM scores ORDER BY score DESC, created_at ASC LIMIT 25').all()
    return json({ ok: true, scores: rows.results ?? [] })
  }

  if (request.method === 'POST') {
    let body: ScoreBody
    try {
      body = await readJson<ScoreBody>(request)
    } catch {
      return json({ ok: false, error: 'expected JSON body' }, { status: 400 })
    }

    const scoreResult = validateScore(body.score)
    if (!scoreResult.ok) return json({ ok: false, error: scoreResult.error }, { status: 400 })
    const nameResult = validateName(body.name)
    if (!nameResult.ok) return json({ ok: false, error: nameResult.error }, { status: 400 })

    const name = nameResult.value
    const score = scoreResult.value
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await env.DB.prepare('INSERT INTO scores (id, name, score, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, score, createdAt)
      .run()
    return json({ ok: true, score: { id, name, score, createdAt } })
  }

  return json({ ok: false, error: 'method not allowed' }, { status: 405 })
}
