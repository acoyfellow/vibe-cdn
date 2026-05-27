# Costs

This is the page that decides whether a vibe-coded browser game lives or dies.

Cloudflare's pricing for the pieces in this stack is so different from a legacy CDN that it changes what is buildable. The short version: **R2 has no egress fee.** That alone removes the failure mode where a popular game obliterates your bank account.

The longer version is on this page.

> Prices below are current as of 2026 and are rounded. Treat them as a budgeting model, not a quote. The live pricing page wins every time.

## The four meters that matter

The stack uses five Cloudflare primitives, but only four of them generate the bulk of the bill.

| Meter            | Where it shows up                | What costs                                    |
|------------------|----------------------------------|-----------------------------------------------|
| R2 storage       | Your `.glb`, `.ktx2`, `.bin`     | $0.015 / GB-month                             |
| R2 Class A ops   | PUTs, lists, copies              | $4.50 / million                               |
| R2 Class B ops   | GETs, HEADs                      | $0.36 / million                               |
| Worker requests  | Every fetch the Worker sees      | Free up to 100k/day, then ~$0.30 / million    |
| DO requests      | Every WebSocket message + fetch  | Bundled into Worker pricing on most plans     |
| DO duration      | While the room is live           | $12.50 / million GB-seconds (small overhead)  |
| D1 reads         | `SELECT` rows                    | $0.001 / 1k rows read                         |
| D1 writes        | `INSERT/UPDATE/DELETE` rows      | $1.00 / million rows written                  |
| KV reads         | `kv.get`                         | $0.50 / million                               |
| KV writes        | `kv.put`, `kv.delete`            | $5.00 / million                               |
| KV storage       | Save-slot JSON                   | $0.50 / GB-month                              |

What you do **not** pay for:

- Bandwidth out of R2 to Cloudflare's edge.
- Bandwidth out of Cloudflare's edge to players.
- Cached delivery of immutable assets after the first edge fetch.
- Class B ops on already-cached objects (the edge serves them).

That third row is the magic. Once `track.glb` lives in cache at an edge node, every player at that edge node gets it without touching R2 again.

## Three concrete scenarios

Assume a 150 MB browser game. One player downloads the bundle on first play and almost nothing on returning sessions (immutable, cached).

### Scenario 1: hobby (1,000 players / month)

- 1,000 players × 1 first download × 150 MB = 150 GB of edge delivery
- Cache hit rate after warm-up: ~95%
- Origin reads from R2: ~50 (the first hits before the asset is cached at each edge)

| Line item               | Cost    |
|-------------------------|---------|
| R2 storage (10 GB)      | $0.15   |
| R2 Class B ops          | < $0.01 |
| Worker requests         | $0.00 (free tier) |
| **Total**               | **~$0.15 / month** |

### Scenario 2: traction (50,000 players / month)

- 50,000 first downloads × 150 MB = 7.5 TB edge delivery
- Origin reads: ~2,500
- Worker requests: ~150,000 (assets + manifest + lobby + scores)

| Line item               | Cost    |
|-------------------------|---------|
| R2 storage (10 GB)      | $0.15   |
| R2 Class B ops          | < $0.01 |
| Worker requests         | ~$0.02  |
| **Total**               | **~$0.20 / month** |

### Scenario 3: viral (5,000,000 players / month)

- 5M first downloads × 150 MB = 750 TB edge delivery
- Origin reads from R2: ~50,000 once cache is warm
- Worker requests: ~50M (assets + manifest + APIs + ws)

| Line item               | Cost    |
|-------------------------|---------|
| R2 storage (10 GB)      | $0.15   |
| R2 Class B ops          | $0.02   |
| Worker requests         | ~$15    |
| **Total**               | **~$15 / month** |

A traditional per-GB CDN at $0.04/GB on 750 TB would be **$30,000+**. That is the multiplier.

> Hit Cloudflare's commercial team before you cross 100M players or 100 TB of stored assets. There is real Enterprise pricing that goes lower per unit, plus dedicated support, real SLAs, and no ToS surprises about "non-HTML asset proportions."

## What changes the math

| Variable                    | Effect                                                            |
|-----------------------------|-------------------------------------------------------------------|
| Larger asset bundle         | Linear increase in edge delivery, ~zero increase in R2 cost.      |
| Lower cache hit rate        | More R2 Class B ops, still cheap unless the asset itself changes per player. |
| Content-addressed assets    | Cache forever, edge-deliver forever. Strongly recommended.        |
| Per-player asset variants   | Pricing leaves "free-egress land." Use shared base + small overlays. |
| Big leaderboards            | D1 writes dominate. Batch them and limit submit rate.             |
| Save slots every frame      | KV writes are not free. Save on level transitions, not on tick.   |
| Long-lived lobbies          | DO duration adds up. Hibernate idle rooms.                        |

## Rules of thumb

1. **Immutable assets, content-addressed.** Name files by `sha256` so the cache never invalidates. Add `Cache-Control: public, max-age=31536000, immutable`. The Worker in this repo does this for you.
2. **One big asset is fine. Pay for compression, not for re-downloads.** Use Draco for geometry, Meshopt for animations, KTX2/Basis for textures. A well-optimized 200 MB scene loads faster than a poorly-optimized 60 MB scene.
3. **Score writes are expensive only if you submit per frame.** Submit once per session.
4. **Save slots are cheap as JSON, expensive as per-frame autosaves.** Save on milestones.
5. **Open the lobby on demand, close it on idle.** Durable Objects bill while alive.

## When to call Cloudflare

If you cross any of these, your project is in commercial-pricing territory:

- More than ~10 TB of stored R2 data.
- More than ~50M Worker requests / day.
- More than ~1M concurrent WebSocket connections.
- Game served outside Cloudflare's standard hosting Terms (e.g., huge non-HTML asset proportion on Free / Pro / Business plans).

Enterprise pricing is negotiated, but it's also where you stop worrying about ToS edge cases. The product team likes seeing real games on the platform.

## The honest part

Numbers move. Cloudflare ships pricing changes. Plans get reshaped. This page is a starting point so you can answer "can I afford to ship this?" in 30 seconds, then double-check on the live page before you launch.

The point is: **this stack does not break at scale because the meter on the most expensive lever (asset delivery) is set to zero.**
