// Live stats. Cheap derived counts from the bindings we already have.
// Cached for 30 seconds at the edge so a viral share doesn't hammer R2.list().
//
//   {
//     assetsStored:      <count of /assets objects>
//     assetsBytes:       <sum of their sizes>
//     uploadsStored:     <count of /u/ ephemeral objects>
//     uploadsBytes:      <sum>
//     scores:            <count of D1 scores>
//     saves:             <count of D1 saves>
//   }
//
// This is intentionally not Workers Analytics Engine yet — that's the
// "real receipts" version where bytes-served, request count, and per-region
// fanout come from sampled logs. Slots in cleanly under the same endpoint
// when we wire it.

import type { Env } from '../env'
import { json } from '../http'

type Stats = {
  assetsStored: number
  assetsBytes: number
  uploadsStored: number
  uploadsBytes: number
  scoresCount: number
  savesCount: number
  generatedAt: string
}

export async function handleStats(_request: Request, env: Env): Promise<Response> {
  const [assets, uploads, scoresRow, savesRow] = await Promise.all([
    env.ASSETS.list({ limit: 1000 }),
    env.UPLOADS.list({ limit: 1000 }),
    env.DB.prepare('SELECT COUNT(*) AS n FROM scores').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM saves').first<{ n: number }>(),
  ])

  const sumBytes = (objects: { size: number }[]) => objects.reduce((acc, o) => acc + o.size, 0)

  const stats: Stats = {
    assetsStored: assets.objects.length,
    assetsBytes: sumBytes(assets.objects),
    uploadsStored: uploads.objects.length,
    uploadsBytes: sumBytes(uploads.objects),
    scoresCount: Number(scoresRow?.n ?? 0),
    savesCount: Number(savesRow?.n ?? 0),
    generatedAt: new Date().toISOString(),
  }

  return json(stats, {
    headers: {
      'cache-control': 'public, max-age=30',
    },
  })
}
