// /install — three quick-starts + the production deploy bootstrap.

import './style.css'
import './site/site.css'
import './install.css'
import { el } from './dom'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

root.classList.add('site-shell')

root.appendChild(buildNav('install'))

const main = el('main', {
  class: 'site-page site-page-narrow install-page',
  children: [
    el('header', {
      class: 'install-hero',
      children: [
        el('p', { class: 'home-eyebrow', text: 'install vibe-cdn' }),
        el('h1', {
          class: 'install-headline',
          text: 'Pick the path that matches your patience.',
        }),
        el('p', {
          class: 'install-lead',
          text:
            'All three give you the same stack — R2 assets, Worker CDN, Durable Object multiplayer, D1 scores, KV saves, and the live arena demo as a reference implementation.',
        }),
      ],
    }),

    optionCard({
      tag: 'option 1',
      title: 'one click → your Cloudflare account',
      blurb:
        "Cloudflare provisions R2, D1, KV, Workers, and points the worker at your account. Forty seconds, no terminal. You get a workers.dev URL you can put anywhere.",
      action: {
        label: 'deploy to Cloudflare',
        href: 'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/vibe-cdn',
        primary: true,
      },
    }),

    optionCard({
      tag: 'option 2',
      title: 'fork into a new repo',
      blurb:
        "Scaffold a fresh copy under your own name. Same code, your repo. Good when you're committing to building on it.",
      code: 'npx tiged acoyfellow/vibe-cdn my-game-cdn\ncd my-game-cdn\nbun install\nbun run demo',
    }),

    optionCard({
      tag: 'option 3',
      title: 'play in StackBlitz',
      blurb:
        "Run the local demo entirely in the browser. No clone, no install. Best when you just want to see the stack respond to your code.",
      action: {
        label: 'open in StackBlitz',
        href: 'https://stackblitz.com/github/acoyfellow/vibe-cdn',
      },
    }),

    el('section', {
      class: 'install-section',
      children: [
        el('h2', { class: 'install-h2', text: 'production deploy from scratch' }),
        el('p', {
          class: 'install-p',
          text:
            "If you cloned the repo and want to push to your own Cloudflare account by hand instead of the deploy button, here's the path. Five commands, two minutes.",
        }),
        el('pre', {
          class: 'install-block',
          children: [
            el('code', {
              text:
                '# 1. create the bindings\n' +
                'wrangler r2 bucket create vibe-cdn-assets\n' +
                'wrangler r2 bucket create vibe-cdn-uploads\n' +
                'wrangler r2 bucket lifecycle add vibe-cdn-uploads --id ttl --expire-days 1\n' +
                'wrangler d1 create vibe-cdn-db\n' +
                'wrangler kv namespace create SAVES\n\n' +
                '# 2. paste the printed IDs into wrangler.jsonc under env.production\n\n' +
                '# 3. migrate the schema and ship\n' +
                'wrangler d1 migrations apply vibe-cdn-db --remote\n' +
                'bun run deploy',
            }),
          ],
        }),
      ],
    }),

    el('section', {
      class: 'install-section',
      children: [
        el('h2', { class: 'install-h2', text: 'what you own once it runs' }),
        el('ul', {
          class: 'install-list',
          children: [
            ownItem('a Worker', 'on a *.workers.dev URL and any custom domain you wire up'),
            ownItem('two R2 buckets', '`vibe-cdn-assets` (permanent) and `vibe-cdn-uploads` (24-hour TTL)'),
            ownItem('a D1 database', 'with the `scores` and `saves` tables migrated'),
            ownItem('a KV namespace', 'for rate limits and edge caches'),
            ownItem('a Durable Object class', '`LobbyDO` — every room is a single-writer state machine, free at any concurrency'),
          ],
        }),
      ],
    }),

    el('section', {
      class: 'install-closer',
      children: [
        el('h2', { class: 'install-closer-h', text: 'next' }),
        el('div', {
          class: 'install-closer-row',
          children: [
            el('a', { class: 'home-cta-primary', attrs: { href: '/demo' }, text: 'see the demo →' }),
            el('a', {
              class: 'home-cta-secondary',
              attrs: { href: '/docs' },
              text: 'read the docs',
            }),
          ],
        }),
      ],
    }),
  ],
})
root.appendChild(main)

root.appendChild(buildFooter())

// ───────────────────────────────────────────────────────────────────────
type OptionCard = {
  tag: string
  title: string
  blurb: string
  code?: string
  action?: { label: string; href: string; primary?: boolean }
}
function optionCard(opt: OptionCard): HTMLElement {
  const children: (HTMLElement | null)[] = [
    el('p', { class: 'install-card-tag', text: opt.tag }),
    el('h3', { class: 'install-card-h', text: opt.title }),
    el('p', { class: 'install-card-p', text: opt.blurb }),
  ]
  if (opt.code) {
    children.push(
      el('pre', {
        class: 'install-block',
        children: [el('code', { text: opt.code })],
      }),
    )
  }
  if (opt.action) {
    children.push(
      el('a', {
        class: opt.action.primary ? 'home-cta-primary' : 'home-cta-secondary',
        attrs: { href: opt.action.href, target: '_blank', rel: 'noreferrer' },
        text: opt.action.label,
      }),
    )
  }
  return el('section', {
    class: 'install-card',
    children: children.filter((c): c is HTMLElement => c !== null),
  })
}

function ownItem(label: string, detail: string): HTMLElement {
  return el('li', {
    class: 'install-own',
    children: [
      el('span', { class: 'install-own-label', text: label }),
      el('span', { class: 'install-own-detail', text: detail }),
    ],
  })
}
