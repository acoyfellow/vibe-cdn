// Brand config — the single source of truth for everything a visitor reads.
//
// The long-term name is undecided. Rather than hardcode "vibe-cdn" across
// every page, nav, footer, title, and CTA, the *visible* brand lives here.
// Renaming later is a one-line change to NAME / WORDMARK / MARK.
//
// What is intentionally NOT here: infrastructure names. The R2 buckets,
// D1 database, KV namespace, Worker name, and deployed domain still carry
// the "vibe-cdn" codename. Those are destructive to rename and there's no
// reason to churn them until a real name is chosen. When that happens, the
// infra rename is a separate, deliberate migration — not coupled to the
// UI rename this file enables.

export const brand = {
  // The visible product name. Change this and the whole UI follows.
  name: 'vibe-cdn',

  // Wordmark shown in nav / hero / footer. Usually same as name.
  wordmark: 'vibe-cdn',

  // Single-letter glyph for the square logo mark.
  mark: 'v',

  // One-liner used in hero / meta.
  tagline: "browser games on Cloudflare's edge",

  // The longer pitch sentence.
  pitch:
    'R2 for the heavy stuff. Workers for the CDN edge. Durable Objects for ' +
    'multiplayer rooms. D1 for scores. KV for caches. Zero egress at any scale.',

  // Where it lives. Used in links + share cards. (Infra/domain codename.)
  domain: 'vibe-cdn.coey.dev',
  url: 'https://vibe-cdn.coey.dev',

  // Source + author.
  repo: 'https://github.com/acoyfellow/vibe-cdn',
  repoSlug: 'acoyfellow/vibe-cdn',
  author: 'https://x.com/acoyfellow',
  authorHandle: '@acoyfellow',

  version: '0.1.0',
} as const

// Convenience: set the document title from a per-page suffix.
export function setTitle(suffix?: string): void {
  document.title = suffix ? `${brand.name} / ${suffix}` : `${brand.name} — ${brand.tagline}`
}
