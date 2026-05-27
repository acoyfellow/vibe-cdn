import type { Env } from '../env'
import { json } from '../http'

export async function handleSave(request: Request, env: Env, player: string, slot: string): Promise<Response> {
  const key = saveKey(player, slot)

  if (request.method === 'GET') {
    const value = await env.SAVES.get(key, 'json')
    return json({ ok: true, player, slot, value })
  }

  if (request.method === 'PUT') {
    const text = await request.text()
    JSON.parse(text)
    await env.SAVES.put(key, text, { metadata: { updatedAt: new Date().toISOString() } })
    return json({ ok: true, player, slot })
  }

  return json({ ok: false, error: 'method not allowed' }, { status: 405 })
}

function saveKey(player: string, slot: string): string {
  return `save:${encodeURIComponent(player)}:${encodeURIComponent(slot)}`
}
