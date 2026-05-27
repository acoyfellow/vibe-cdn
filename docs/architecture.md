# Architecture

Five Cloudflare primitives, one Worker as the front door. Every box is a real piece of infrastructure.

```text
                       ┌─────────────────────────────┐
   ┌─────────────┐     │       Cloudflare edge       │     ┌─────────────────┐
   │   browser   │ ──► │  cache: immutable / Range   │ ──► │     Worker      │
   │  your game  │     │  origin: vibe-cdn worker    │     │   vibe-cdn      │
   └─────────────┘     └─────────────────────────────┘     └────────┬────────┘
                                                                    │
                ┌──────────────────────┬──────────────┼──────────────────────┐
                ▼                      ▼              ▼              ▼              ▼
       ┌───────────────┐      ┌────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
       │   R2 bucket   │      │  Durable Object│ │    D1    │ │    KV    │ │  App assets  │
       │ vibe-cdn-     │      │     LobbyDO    │ │vibe-cdn- │ │  SAVES   │ │  (Pages-     │
       │   assets      │      │                │ │   db     │ │          │ │  shape       │
       │  .glb .ktx2   │      │  WebSocket     │ │  scores  │ │  saves   │ │  binding)    │
       │  .bin .wasm   │      │  rooms,        │ │  table   │ │  blobs   │ │              │
       │               │      │  state-per-id  │ │          │ │          │ │              │
       └───────────────┘      └────────────────┘ └──────────┘ └──────────┘ └──────────────┘
        big assets             multiplayer        scores       slots         SPA + UI
```

## Routes the Worker owns

| Route                         | Method        | Reads / writes                | Purpose                                          |
|-------------------------------|---------------|-------------------------------|--------------------------------------------------|
| `/health`                     | GET           | none                          | Liveness + binding presence                      |
| `/manifest.json`              | GET, HEAD     | R2 GET `__manifest.json`      | Asset catalog for the client                     |
| `/assets/:key`                | GET, HEAD     | R2 GET, HEAD                  | The CDN edge for game assets                     |
| `/__dev/upload/:key`          | PUT, OPTIONS  | R2 PUT                        | Local-only convenience; 403 in production        |
| `/api/scores`                 | GET, POST     | D1 SELECT, INSERT             | Leaderboard                                      |
| `/api/saves/:player/:slot`    | GET, PUT      | KV get, put                   | Per-player save blob                             |
| `/api/cost/estimate`          | GET           | none (pure math)              | Cost calculator                                  |
| `/ws/lobby/:id`               | GET (upgrade) | DO fetch + WebSocket          | Multiplayer room                                 |
| anything else                 | any           | `APP_ASSETS.fetch(request)`   | Serve the built SPA                              |

## The asset path, end to end

```text
GET /assets/demo/track.glb
    Range: bytes=0-1048575

1. Cloudflare edge:
       cache lookup against the immutable URL.
       hit → 206 Partial Content from cache.
       miss → forward to Worker.

2. Worker:
       env.ASSETS.head(key) for size + ETag.
       resolve Range against size.
       env.ASSETS.get(key, { range }) for bytes.
       write headers:
         content-range: bytes 0-1048575/183234234
         content-type:  model/gltf-binary
         cache-control: public, max-age=31536000, immutable
         accept-ranges: bytes
         etag:          "abc123"
       respond 206 Partial Content.

3. Browser:
       Three.js GLTFLoader parses the bytes.
       subsequent edge requests hit cache for the lifetime of the asset.
```

The asset URL is the cache key. Naming files by their `sha256` makes every asset immutable forever, so the cache is never wrong.

## The lobby path

```text
GET /ws/lobby/<room-id>     Upgrade: websocket

1. Worker:
       LOBBY.idFromName(<room-id>) → DurableObjectId
       LOBBY.get(id).fetch(request)

2. LobbyDO:
       accept WebSocket pair
       assign player id
       attach message listener
       broadcast snapshot to all sockets

3. Player sends:
       { type: "join", name: "alice" }
       { type: "move", x, y, z }
       { type: "ping", t }

4. Server emits to everyone in the room:
       { type: "snapshot", players: [...] }
       { type: "pong", t, now }   (only to the pinger)
```

Each Durable Object instance is a single-writer container for one room. Cloudflare guarantees only one copy is running anywhere in the world for a given id, which is what makes it the right primitive for shared physics or racing-lobby state.

## Score and save paths

Scores are append-only and sorted by score descending. The path is intentionally tiny:

```sql
CREATE TABLE scores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX scores_score_idx ON scores(score DESC, created_at ASC);
```

```text
POST /api/scores  body: { name, score }
GET  /api/scores  → top 25
```

Saves are JSON blobs in KV, namespaced by player and slot:

```text
PUT /api/saves/:player/:slot  body: <any JSON>
GET /api/saves/:player/:slot  → { ok, value }
```

The Worker validates the body parses as JSON before writing, so the data layer never holds invalid payloads.

## Local vs production

| Concern             | Local (`bun run demo`)                              | Production                                  |
|---------------------|------------------------------------------------------|---------------------------------------------|
| R2 bucket           | Miniflare, files under `.wrangler/state/`            | Real R2 bucket                              |
| D1 database         | Miniflare SQLite                                     | Real D1 with replicas                       |
| KV namespace        | Miniflare                                            | Real KV                                     |
| Durable Objects     | Miniflare (single-process)                           | Real DOs distributed by id                  |
| `/__dev/upload/:key`| Enabled (`ALLOW_DEV_UPLOADS=true`)                  | Disabled (returns 403)                      |
| Cache               | None (Worker reaches origin directly)                | Edge cache by URL                           |
| Cloudflare account  | Not required                                         | Required                                    |
| Worker assets       | Built once into `app/dist`                           | Served via the `assets` binding             |

The point is: the code that runs in dev is the code that runs in production. Bindings change, behavior doesn't.

## Concurrency model

- **Worker** is request-scoped, no shared state. Anything stateful lives in a binding.
- **Durable Object** is single-writer per id; serialize state without locks inside one DO.
- **D1** is read-replicated; writes go to a single primary. Use it for things where eventual consistency is fine.
- **KV** is eventually consistent. Reads from the same edge are coherent; cross-region writes propagate within seconds. Don't use it for racing-lobby state.
- **R2** is strongly consistent for the same key. Reads after a PUT see the new bytes.

If you need strong order or single-writer guarantees (chat history, room state, score-from-trusted-server), use a Durable Object. For everything else, the lighter primitive is fine.

## What this stack does not include

By design, 0.0.1 leaves out:

- Authentication (no users yet). Add Turnstile + a Worker auth route when you ship.
- Anti-cheat. Score writes are open. Add Turnstile and a server-validated submit before going public.
- Asset compression pipeline (Draco / Meshopt / KTX2). Use `@gltf-transform/cli` separately for now; a `bun run optimize` script is on the roadmap.
- Multi-region session pinning. Durable Objects pick a region automatically based on first access. For racing latency you may want explicit `idFromName` strategies.
- Custom domains and routing. See `docs/deploy.md`.

These are deliberate. The stack should be small enough to read top to bottom before you trust it.
