// Game saves on D1.
//
// Why D1 and not KV: KV is eventually consistent. After a write, reads from
// a different edge can return stale data for up to ~60 seconds. That's fine
// for feature flags or cosmetics; it's a footgun for game progress, where
// the user can lose level/inventory state if they save, then reload through
// a different edge (network handoff, multi-device, etc.).
//
// D1 is strongly consistent globally. The table is tiny: (player, slot) ->
// JSON blob + updated_at. INSERT OR REPLACE makes the write a one-liner.
//
// KV is still bound on the Worker (`env.SAVES`) for things it's actually
// good at: A/B variants, session caches, edge-cached read-mostly data.

import { validateSaveBody, validateSaveKey } from '../../shared/validate'
import type { Env } from '../env'
import { json } from '../http'

export async function handleSave(
  request: Request,
  env: Env,
  player: string,
  slot: string,
): Promise<Response> {
  const playerKey = validateSaveKey(player)
  if (!playerKey.ok) return json({ ok: false, error: `player: ${playerKey.error}` }, { status: 400 })
  const slotKey = validateSaveKey(slot)
  if (!slotKey.ok) return json({ ok: false, error: `slot: ${slotKey.error}` }, { status: 400 })

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT data, updated_at AS updatedAt FROM saves WHERE player = ? AND slot = ?',
    )
      .bind(player, slot)
      .first<{ data: string; updatedAt: string }>()

    if (!row) return json({ ok: true, player, slot, value: null, updatedAt: null })

    let value: unknown
    try {
      value = JSON.parse(row.data)
    } catch {
      value = row.data
    }
    return json({ ok: true, player, slot, value, updatedAt: row.updatedAt })
  }

  if (request.method === 'PUT') {
    const raw = await request.text()
    const body = validateSaveBody(raw)
    if (!body.ok) {
      const status = body.error === 'save body is too large' ? 413 : 400
      return json({ ok: false, error: body.error }, { status })
    }
    const text = body.value
    const updatedAt = new Date().toISOString()
    await env.DB.prepare(
      'INSERT INTO saves (player, slot, data, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (player, slot) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    )
      .bind(player, slot, text, updatedAt)
      .run()
    return json({ ok: true, player, slot, updatedAt })
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM saves WHERE player = ? AND slot = ?').bind(player, slot).run()
    return json({ ok: true, player, slot, deleted: true })
  }

  return json({ ok: false, error: 'method not allowed' }, { status: 405 })
}
