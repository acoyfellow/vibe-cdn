export type HealthResponse = {
  ok: true
  name: 'vibe-cdn'
  version: '0.0.1'
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
  | { type: 'move'; x: number; y: number; z: number }
  | { type: 'ping'; t: number }

export type LobbyPlayer = {
  id: string
  name: string
  x: number
  y: number
  z: number
  seenAt: number
}

export type LobbyServerMessage =
  | { type: 'hello'; id: string }
  | { type: 'snapshot'; players: LobbyPlayer[] }
  | { type: 'pong'; t: number; now: number }
  | { type: 'error'; message: string }
