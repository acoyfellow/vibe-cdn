# Deploying vibe-cdn to your Cloudflare account

This is the second page. Get the local demo green first (`bun run demo`).

## What you will create

- One Worker named `vibe-cdn`
- One R2 bucket: `vibe-cdn-assets`
- One D1 database: `vibe-cdn-db`
- One KV namespace bound as `SAVES`
- One Durable Object class: `LobbyDO`

## Bootstrap

```bash
wrangler login

wrangler r2 bucket create vibe-cdn-assets
wrangler d1 create vibe-cdn-db
wrangler kv namespace create SAVES
```

Each command prints an ID. Open `wrangler.jsonc` and paste them into the matching slots:

- `r2_buckets[0].bucket_name`     -> already set
- `d1_databases[0].database_id`   -> replace `local-vibe-cdn-db`
- `kv_namespaces[0].id`           -> replace `local-vibe-cdn-saves`

Apply the schema:

```bash
wrangler d1 migrations apply vibe-cdn-db --remote --yes
```

## Disable dev uploads in production

In `wrangler.jsonc` set:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "ALLOW_DEV_UPLOADS": "false"
}
```

`/__dev/upload/:key` will return 403 in production. Use `wrangler r2 object put` or your own protected upload route to push assets.

## Ship

```bash
bun run deploy
```

`bun run deploy` runs `vite build` (writes `app/dist`) and then `wrangler deploy`. The Worker serves the SPA via the `assets` binding and the API on the same domain.

## Optional: custom domain

If you want `assets.yourgame.com`:

```bash
wrangler dev --route 'assets.yourgame.com/*'
```

Or set a `routes` block in `wrangler.jsonc`. See Cloudflare's Workers routing docs for the current syntax.

## Upload assets to R2

The simplest way:

```bash
wrangler r2 object put vibe-cdn-assets/demo/track.glb --file ./raw/track.glb \
  --content-type model/gltf-binary \
  --cache-control 'public, max-age=31536000, immutable'
```

For content-addressed bundles, name your files after their sha256 so cache invalidation is automatic.

## Cost notes

R2 has no egress fees. You pay for storage (per GB-month) and class A/B operations. Worker requests are billed per million. Durable Object requests + storage are billed separately. KV is reads + writes + storage. D1 is reads + writes + rows-read.

For most "fewer than 100k players a month" browser games, this stack stays in the low single-digit dollars. Once you cross into millions of players, talk to Cloudflare about an Enterprise plan.

Numbers move. Check the live pricing page before you commit.
