import {
  MAX_LEADERBOARD_ROWS,
  SCORE_WRITES_PER_HOUR,
  clientIp,
  hourBucket,
  rateCounterKey,
  rateDecision,
} from '../../shared/ratelimit'
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

    const ip = clientIp(request.headers.get('cf-connecting-ip'))
    const counterKey = rateCounterKey('scores', ip, hourBucket(Date.now()))
    const decision = rateDecision(await env.SAVES.get(counterKey), SCORE_WRITES_PER_HOUR)
    if (!decision.allowed) {
      return json(
        { ok: false, error: `rate limit: ${decision.limit} score writes per hour per IP. try again later.` },
        { status: 429, headers: { 'retry-after': '3600' } },
      )
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
    await env.SAVES.put(counterKey, String(decision.used + 1), { expirationTtl: 3600 })
    await env.DB.prepare(
      'DELETE FROM scores WHERE id NOT IN (SELECT id FROM scores ORDER BY score DESC, created_at ASC LIMIT ?)',
    )
      .bind(MAX_LEADERBOARD_ROWS)
      .run()
    return json({ ok: true, score: { id, name, score, createdAt } })
  }

  return json({ ok: false, error: 'method not allowed' }, { status: 405 })
}
