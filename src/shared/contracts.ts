// Visible product name. The single source of truth for the worker side.
// Mirrors app/src/brand.ts on the client. Rename in both places when a
// long-term name is chosen. Infra names (buckets, db, worker) are separate.
export const BRAND_NAME = 'vibe-cdn'
export const BRAND_VERSION = '0.1.0'

export type HealthResponse = {
  ok: true
  name: string
  version: string
  bindings: {
    r2: boolean
    d1: boolean
    kv: boolean
    durableObjects: boolean
  }
}

export type AssetManifestEntry = {
  key: string
  url: string
  contentType: string
  bytes: number
  sha256: string
  immutable: boolean
}

export type AssetManifest = {
  generatedAt: string
  assets: AssetManifestEntry[]
}

export type Score = {
  id: string
  name: string
  score: number
  createdAt: string
}

export type LobbyClientMessage =
  | { type: 'join'; name: string }
  | {
      type: 'move'
      x: number
      y: number
      z: number
      ry?: number      // yaw in radians
      seq?: number     // client-side monotonic, lets the DO drop reorders
      t?: number       // client send-time (performance.now), echoed in pong
    }
  | { type: 'lap'; lap: number; lastLapMs?: number }
  | { type: 'ping'; t: number }
  | { type: 'fire'; x: number; z: number; ry: number }
  | {
      type: 'spawn'
      kind: EntityKind
      url?: string
      x: number
      z: number
      ry?: number
      scale?: number
      label?: string
    }

export type EntityKind = 'prop' | 'boss'

export type ArenaEntity = {
  id: string
  kind: EntityKind
  url?: string
  x: number
  y: number
  z: number
  ry: number
  scale: number
  label?: string
  ownerId?: string
  createdAt: number
  hp?: number
  maxHp?: number
}

export type LobbyPlayer = {
  id: string
  name: string
  x: number
  y: number
  z: number
  ry: number
  lap?: number
  lastLapMs?: number
  seenAt: number
  hp?: number
  kills?: number
}

export type LobbyServerMessage =
  | { type: 'hello'; id: string; tickRate: number; serverNow: number }
  | {
      // Back-compat alias for the old 'snapshot' (the lobby panel still reads this).
      type: 'snapshot'
      players: LobbyPlayer[]
    }
  | {
      type: 'state'
      tick: number
      serverNow: number
      players: LobbyPlayer[]
      entities?: ArenaEntity[]
      leaderId?: string
    }
  | {
      type: 'shot'
      fromId: string
      x: number
      z: number
      ry: number
      range: number
      hitId?: string
      hitKind?: 'player' | 'boss'
    }
  | { type: 'pong'; t: number; now: number }
  | { type: 'error'; message: string }
