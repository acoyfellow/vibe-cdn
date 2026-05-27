# fixtures/

Local-only test assets for the vibe-cdn demo. **Nothing in this directory is
shipped to production** — it exists so `bun scripts/seed-local.ts` and
`bun scripts/smoke.ts` can stand the Worker up against deterministic content
without bundling large binaries into the repo.

## Layout

```
fixtures/
  README.md             ← this file
  generated/            ← created by scripts/gen-fixtures.ts (gitignored)
    manifest.json       ← AssetManifest mirror of what /manifest.json should serve
    models/tiny.glb     ← ~120-byte spec-valid binary glTF (single triangle)
    blobs/large.bin     ← 8 MiB deterministic xorshift32 blob (seed 0xC0FFEE)
```

`generated/` is built on demand and is safe to delete; it will be re-created
on the next run.

## Regenerating

```bash
bun scripts/gen-fixtures.ts        # write files only
bun scripts/seed-local.ts          # generate + PUT to local worker
bun scripts/seed-local.ts \
  --worker http://127.0.0.1:8787 \
  --skip-generate                  # reuse already-generated files
```

The seed script targets the dev-only `PUT /__dev/upload/:key` endpoint, so the
Worker must be running with `ALLOW_DEV_UPLOADS=true` (the default in
`wrangler.jsonc` for local dev).

## What the GLB contains

`models/tiny.glb` is hand-built rather than authored through `@gltf-transform`
to keep the script dependency-free at runtime and stable across versions. It
encodes the glTF 2.0 binary container:

| Section     | Bytes        | Purpose                                            |
| ----------- | ------------ | -------------------------------------------------- |
| Header      | 12           | magic `glTF`, version 2, total length              |
| JSON chunk  | aligned to 4 | scene/node/mesh/accessor referencing the BIN chunk |
| BIN chunk   | 36           | three `VEC3` `FLOAT` positions for a triangle      |

You can sanity-check it with any glTF validator (e.g.
`npx @khronosgroup/gltf-validator fixtures/generated/models/tiny.glb`).

## What the large blob contains

`blobs/large.bin` is exactly `8 * 1024 * 1024 = 8_388_608` bytes of
xorshift32 output seeded with `0xC0FFEE`. The same seed produces identical
bytes on every run, which makes range requests and ETag comparisons
deterministic across machines.
