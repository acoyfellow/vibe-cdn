# vibe-cdn

A Cloudflare game stack for heavy browser games.

R2 for big assets. Workers for the CDN edge. Durable Objects for rooms. D1 for scores. KV for saves.

One command runs it all locally. No Cloudflare account required.

## Quick start

```bash
bun install
bun run demo
```

Open <http://127.0.0.1:5173>. You should see seven panels:

1. health check (which Cloudflare bindings are alive)
2. a 3D model loading from local R2
3. range-request stress test
4. a real multiplayer lobby (open a second tab)
5. a leaderboard (D1)
6. a save slot (KV)
7. a cost estimator

If every status pill is green, the stack is working.

## What changes first

Drop your own `.glb` here:

```text
fixtures/generated/demo/triangle.glb
```

Then:

```bash
bun run seed
```

Refresh the page. The model panel now shows your model. That is the whole golden loop.

## What this gives you

- An R2-backed Worker route at `/assets/:key` with:
  - Correct MIME types for `.glb`, `.gltf`, `.ktx2`, `.wasm`, audio, video, images
  - `Cache-Control: public, max-age=31536000, immutable`
  - `Accept-Ranges: bytes`, real `206 Partial Content` for `Range:` requests
  - ETag + `If-None-Match` -> `304 Not Modified`
  - Open CORS (game clients can fetch from anywhere)
- A Durable Object lobby at `/ws/lobby/:id` for WebSocket multiplayer
- A D1 leaderboard at `/api/scores`
- A KV save-slot endpoint at `/api/saves/:player/:slot`
- A small cost estimator at `/api/cost/estimate`
- A shared `__manifest.json` so the client knows what is in the bucket

## Commands

```bash
bun run demo       # the golden path: migrate + worker + seed + app
bun run smoke      # run end-to-end checks against the local worker
bun run check      # typecheck everything
bun run build      # build app + dry-run worker deploy
bun run seed       # regenerate fixtures and re-upload to local R2
bun run deploy     # push to your Cloudflare account (see docs/deploy.md)
```

## More docs

- [`docs/architecture.md`](docs/architecture.md) — every route, every primitive, every diagram.
- [`docs/costs.md`](docs/costs.md) — how the math works at 1k, 50k, 5M players.
- [`docs/deploy.md`](docs/deploy.md) — bootstrap your Cloudflare account in one pass.

## Deploy

Local first. When you are ready to put this on the internet, see [`docs/deploy.md`](docs/deploy.md). The shape is:

```bash
wrangler r2 bucket create vibe-cdn-assets
wrangler d1 create vibe-cdn-db
wrangler kv namespace create SAVES
bun run deploy
```

## Why this exists

Big browser games (Three.js, WebGPU, cloth sim, racing games) hit a wall at "how do I serve a 200 MB asset bundle without going broke?". R2 has no egress fee, Workers add the cache and routing, Durable Objects do rooms, D1 does scores. This repo bundles those pieces into one starter you can read top to bottom and copy a piece at a time.

## Status

0.0.1, local-tested. Built to be forked. MIT.

Built by [@acoyfellow](https://x.com/acoyfellow). Inspired by friends building real things in the open.
