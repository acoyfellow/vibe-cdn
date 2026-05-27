export type CostInput = {
  bundleMb: number
  monthlyPlayers: number
  sessionsPerPlayer: number
  cacheHitRate: number
  storageGb: number
}

export type CostEstimate = {
  monthlyAssetReads: number
  originReadGb: number
  cachedDeliveryGb: number
  r2StorageDollars: number
  r2ClassBDollars: number
  roughTotalDollars: number
  note: string
}

export function estimateCost(input: CostInput): CostEstimate {
  const sessions = input.monthlyPlayers * input.sessionsPerPlayer
  const totalGb = (sessions * input.bundleMb) / 1024
  const missRate = Math.max(0, Math.min(1, 1 - input.cacheHitRate))
  const originReadGb = totalGb * missRate
  const monthlyAssetReads = sessions
  const r2StorageDollars = input.storageGb * 0.015
  const r2ClassBDollars = (monthlyAssetReads / 1_000_000) * 0.36
  return {
    monthlyAssetReads,
    originReadGb,
    cachedDeliveryGb: totalGb,
    r2StorageDollars,
    r2ClassBDollars,
    roughTotalDollars: r2StorageDollars + r2ClassBDollars,
    note: 'Cloudflare CDN egress is not charged like legacy per-GB CDN egress. Real bills depend on plan, cache behavior, request volume, and product limits.',
  }
}
