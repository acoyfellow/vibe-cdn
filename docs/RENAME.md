# Renaming the project

The name `vibe-cdn` is a working codename, not a commitment. The repo is
structured so a rename is cheap. This doc is the checklist.

## The split

There are two kinds of "name" in this repo, and they rename independently.

### 1. The visible brand (cheap, do this first)

Everything a visitor reads comes from two files:

- `app/src/brand.ts` — the client UI (nav, footer, hero, titles, CTAs, share links)
- `src/shared/contracts.ts` — `BRAND_NAME` / `BRAND_VERSION` (the worker `/health` name)

Rename the brand:

```ts
// app/src/brand.ts
export const brand = {
  name: 'your-name',
  wordmark: 'your-name',
  mark: 'y',
  tagline: '...',
  // domain / url / repo update when those move
}
```

```ts
// src/shared/contracts.ts
export const BRAND_NAME = 'your-name'
```

That's the whole visible rename. Build, deploy, done. The infra keeps
running under its old names — nothing breaks.

### 2. The infrastructure names (destructive, do this deliberately, later)

These are Cloudflare resource names. Renaming them means creating new
resources and migrating data. Don't do it casually.

| Thing                | Current name        | Where                     |
|----------------------|---------------------|---------------------------|
| Worker               | `vibe-cdn`          | `wrangler.jsonc` name      |
| R2 assets bucket     | `vibe-cdn-assets`   | `wrangler.jsonc` + scripts  |
| R2 uploads bucket    | `vibe-cdn-uploads`  | `wrangler.jsonc`           |
| D1 database          | `vibe-cdn-db`       | `wrangler.jsonc` + migrations cmds |
| KV namespace binding | `SAVES`             | (binding name, not branded) |
| Durable Object class | `LobbyDO`           | (class name, not branded)  |
| Domain               | `vibe-cdn.coey.dev` | `wrangler.jsonc` routes     |
| GitHub repo          | `acoyfellow/vibe-cdn` | git remote + `brand.repoSlug` |

When the real name is chosen and you want to migrate infra:

1. Create the new R2 buckets, D1 db, KV namespace under the new names.
2. Copy R2 objects: `wrangler r2 object ...` or rclone between buckets.
3. Re-run D1 migrations on the new db; export/import rows if any matter.
4. Update `wrangler.jsonc` (worker name, bucket names, db name/id, route).
5. Update `brand.ts` domain/url/repo + `brand.repoSlug`.
6. Rename the GitHub repo (GitHub redirects the old slug automatically).
7. Deploy. Point the new domain. Retire the old worker.

R2 has no egress fees, so copying objects between buckets is effectively
free — the bucket migration is the easy part.

## Why it's structured this way

Picking a name under pressure produces a name you regret. Decoupling the
visible brand from the infrastructure lets the product ship and get
feedback under a codename while the real name is still in the oven. When
it's ready, the UI rename is one line and the infra rename is a planned
migration, not a frantic find-and-replace.
