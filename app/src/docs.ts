// /docs — landing page that points at the canonical docs on GitHub.

import './style.css'
import './site/site.css'
import './install.css'
import { el } from './dom'
import { brand, setTitle } from './brand'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

setTitle('docs')
root.classList.add('site-shell')

root.appendChild(buildNav('docs'))

const DOCS: { title: string; blurb: string; href: string }[] = [
  {
    title: 'architecture',
    blurb:
      'Every route, every primitive. Asset path traced step-by-step. Lobby path traced step-by-step. Local-vs-prod table. Concurrency model. Why D1 and not KV for saves.',
    href: `${brand.repo}/blob/main/docs/architecture.md`,
  },
  {
    title: 'costs',
    blurb:
      'The four meters that actually bill (R2 storage, class A/B ops, Worker requests, DO duration). Three concrete scenarios at 1k, 50k, and 5M players with line-item totals. Rules of thumb. When to call Cloudflare.',
    href: `${brand.repo}/blob/main/docs/costs.md`,
  },
  {
    title: 'deploy',
    blurb:
      "Bootstrap the bindings (R2, D1, KV, DO), wire wrangler.jsonc, disable the dev upload route, ship. Custom domain notes. Uploading assets to R2 with content-addressed keys.",
    href: `${brand.repo}/blob/main/docs/deploy.md`,
  },
]

const main = el('main', {
  class: 'site-page site-page-narrow install-page',
  children: [
    el('header', {
      class: 'install-hero',
      children: [
        el('p', { class: 'home-eyebrow', text: 'documentation' }),
        el('h1', {
          class: 'install-headline',
          text: 'Three docs, all canonical, all in the repo.',
        }),
        el('p', {
          class: 'install-lead',
          text:
            "Each doc lives in github.com/acoyfellow/vibe-cdn under /docs. They render natively on GitHub, fork with your code, and stay in sync with the repo. Open the link, read, search, blame.",
        }),
      ],
    }),

    ...DOCS.map((d) =>
      el('a', {
        class: 'install-card docs-card',
        attrs: { href: d.href, target: '_blank', rel: 'noreferrer' },
        children: [
          el('p', { class: 'install-card-tag', text: 'docs/' + d.title + '.md' }),
          el('h3', { class: 'install-card-h', text: d.title }),
          el('p', { class: 'install-card-p', text: d.blurb }),
          el('span', { class: 'docs-card-arrow', text: 'read on GitHub →' }),
        ],
      }),
    ),

    el('section', {
      class: 'install-section',
      children: [
        el('h2', { class: 'install-h2', text: 'short answers' }),
        el('ul', {
          class: 'install-list',
          children: [
            faqItem(
              'is R2 really free?',
              "Storage and request operations cost money. Egress out of R2 (to Cloudflare's edge, then to your players) is free. That's the math that makes browser games viable at scale.",
            ),
            faqItem(
              "why D1 and not KV for saves?",
              "KV is eventually consistent. A player saves on one edge, then reads through a different edge, and the read can return the old save — progress lost. D1 is strongly consistent globally.",
            ),
            faqItem(
              'how does multiplayer work?',
              "Durable Objects. Each `/ws/lobby/:id` opens a WebSocket against the DO with that name. The DO is the single writer for room state and fans out a 20 Hz tick. Snapshot interpolation on the client smooths it to 60 fps.",
            ),
            faqItem(
              'do I need a Cloudflare account?',
              "No, for the local demo. Yes, to deploy. `wrangler login` once, then `bun run deploy`.",
            ),
            faqItem(
              'is this production-ready?',
              "It's local-tested, prod-tested, MIT, and the prod demo at vibe-cdn.coey.dev is the same code in this repo. Treat it as a starting point — your game's auth, anti-cheat, and asset-upload protections are still your call.",
            ),
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
            el('a', { class: 'home-cta-secondary', attrs: { href: '/install' }, text: 'install' }),
          ],
        }),
      ],
    }),
  ],
})
root.appendChild(main)

root.appendChild(buildFooter())

function faqItem(q: string, a: string): HTMLElement {
  return el('li', {
    class: 'install-own faq-item',
    children: [
      el('span', { class: 'install-own-label', text: q }),
      el('span', { class: 'install-own-detail faq-answer', text: a }),
    ],
  })
}
