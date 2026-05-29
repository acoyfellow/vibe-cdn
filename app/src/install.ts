// /install — three quick-starts + the production deploy bootstrap.

import './style.css'
import './site/site.css'
import './install.css'
import { el } from './dom'
import { brand, setTitle } from './brand'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

setTitle('install')
root.classList.add('site-shell')

root.appendChild(buildNav('install'))

const main = el('main', {
  class: 'site-page site-page-narrow install-page',
  children: [
    el('header', {
      class: 'install-hero',
      children: [
        el('p', { class: 'home-eyebrow', text: `install ${brand.name}` }),
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

    // ── Honest prerequisites. The part most starter repos hide. ──────────────
    el('section', {
      class: 'install-prereq',
      children: [
        el('h2', { class: 'install-prereq-h', text: 'before you start — the honest version' }),
        el('p', {
          class: 'install-prereq-lead',
          html:
            'Running the demo on your laptop is <strong>free and needs nothing but Bun</strong>. ' +
            'Deploying the <em>multiplayer</em> version to the internet needs a paid Cloudflare plan. ' +
            'Here is exactly what each path costs and requires — no surprises on your card.',
        }),
        el('div', {
          class: 'prereq-grid',
          children: [
            prereqCard({
              tier: 'run it locally',
              price: '$0',
              priceNote: 'forever',
              needs: [
                'Bun installed (bun.sh)',
                'that is the whole list',
              ],
              note: 'Miniflare emulates R2, D1, KV, and Durable Objects on your machine. No account, no card, no internet. This is the `bun run demo` path.',
              tone: 'free',
            }),
            prereqCard({
              tier: 'deploy assets + CDN',
              price: '$0',
              priceNote: 'free tier',
              needs: [
                'a free Cloudflare account',
                'wrangler login (once)',
              ],
              note: 'R2, D1, KV, and a single Worker all have generous free tiers. A small game lives here at $0/mo. R2 has no egress fee, so asset delivery stays free as you grow.',
              tone: 'free',
            }),
            prereqCard({
              tier: 'deploy multiplayer',
              price: '$5',
              priceNote: 'per month, minimum',
              needs: [
                'a Cloudflare account',
                'the Workers Paid plan ($5/mo)',
              ],
              note: 'The live arena uses SQLite-backed Durable Objects, which require the Workers Paid plan. That $5/mo is a flat platform fee (not per-game) and covers 10M requests + plenty of DO usage. If you do not need realtime multiplayer, skip the DO and stay on free.',
              tone: 'paid',
            }),
          ],
        }),
        el('p', {
          class: 'install-prereq-foot',
          html:
            'The one number that matters at scale: <strong>R2 egress is $0</strong>. A viral game that would cost five figures a month on a per-GB CDN ' +
            'costs single-digit dollars here — mostly the flat $5 Workers fee plus tiny storage. See the ' +
            '<a href="' + brand.repo + '/blob/main/docs/costs.md" target="_blank" rel="noreferrer">cost breakdown</a> ' +
            'for the math at 1k / 50k / 5M players.',
        }),
      ],
    }),

    optionCard({
      tag: 'option 1',
      title: 'one click → your Cloudflare account',
      blurb:
        "Cloudflare forks the repo, provisions R2, D1, KV, and the Worker, and deploys. No terminal. You get a workers.dev URL. Note: the multiplayer arena needs the Workers Paid plan ($5/mo) because it uses Durable Objects — Cloudflare will prompt you to upgrade if you are on free.",
      action: {
        label: 'deploy to Cloudflare',
        href: `https://deploy.workers.cloudflare.com/?url=${brand.repo}`,
        primary: true,
      },
    }),

    optionCard({
      tag: 'option 2',
      title: 'fork into a new repo',
      blurb:
        "Scaffold a fresh copy under your own name. Same code, your repo. Good when you're committing to building on it.",
      code: `npx tiged ${brand.repoSlug} my-game\ncd my-game\nbun install\nbun run demo`,
    }),

    optionCard({
      tag: 'option 3',
      title: 'play in StackBlitz',
      blurb:
        "Run the local demo entirely in the browser. No clone, no install. Best when you just want to see the stack respond to your code.",
      action: {
        label: 'open in StackBlitz',
        href: `https://stackblitz.com/github/${brand.repoSlug}`,
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

type PrereqCard = {
  tier: string
  price: string
  priceNote: string
  needs: string[]
  note: string
  tone: 'free' | 'paid'
}
function prereqCard(p: PrereqCard): HTMLElement {
  return el('div', {
    class: `prereq-card prereq-${p.tone}`,
    children: [
      el('div', {
        class: 'prereq-price-row',
        children: [
          el('span', { class: 'prereq-price', text: p.price }),
          el('span', { class: 'prereq-price-note', text: p.priceNote }),
        ],
      }),
      el('h3', { class: 'prereq-tier', text: p.tier }),
      el('ul', {
        class: 'prereq-needs',
        children: p.needs.map((n) => el('li', { text: n })),
      }),
      el('p', { class: 'prereq-note', text: p.note }),
    ],
  })
}
