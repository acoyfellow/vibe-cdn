// Homepage. The story. The pitch. The two CTAs.

import './style.css'
import './site/site.css'
import './home.css'
import { el } from './dom'
import { brand, setTitle } from './brand'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

setTitle()
root.classList.add('site-shell')

// ── Nav ────────────────────────────────────────────────────────────────
root.appendChild(buildNav('home'))

// ── Hero ───────────────────────────────────────────────────────────────
const hero = el('section', {
  class: 'home-hero site-page',
  children: [
    el('div', {
      class: 'home-hero-copy',
      children: [
        el('p', { class: 'home-eyebrow', text: 'a Cloudflare game stack' }),
        el('h1', {
          class: 'home-headline',
          children: [
            el('span', { text: 'Ship browser games' }),
            el('br'),
            el('span', { text: 'without ' }),
            el('strong', { text: 'the asset-bill scare.' }),
          ],
        }),
        el('p', {
          class: 'home-lead',
          text: `${brand.pitch} One repo, one deploy.`,
        }),
        el('div', {
          class: 'home-cta-row',
          children: [
            el('a', { class: 'home-cta-primary', attrs: { href: '/demo' }, text: 'see the demo →' }),
            el('a', { class: 'home-cta-secondary', attrs: { href: '/install' }, text: 'install' }),
          ],
        }),
      ],
    }),
    // The absurd 3D logo splash as the hero brand visual.
    el('div', {
      class: 'home-hero-art',
      children: [
        el('img', {
          class: 'home-hero-logo',
          attrs: {
            src: '/brand/logo-splash.jpg',
            alt: 'vibe-cdn logo: a chrome v glazed in molten Cloudflare orange',
            loading: 'eager',
            width: '520',
            height: '520',
          },
        }),
      ],
    }),
  ],
})
root.appendChild(hero)

// ── Live arena ───────────────────────────────────────────────────────────
const liveArena = el('section', {
  class: 'home-live site-page',
  children: [
    el('h2', { class: 'home-h', text: 'live, right now' }),
    el('div', {
      class: 'home-iframe-frame',
      children: [
        el('iframe', {
          class: 'home-iframe',
          attrs: {
            src: '/embed/arena',
            title: 'Live multiplayer arena',
            loading: 'lazy',
            allow: 'autoplay',
          },
        }),
        el('a', {
          class: 'home-iframe-open',
          attrs: { href: '/demo' },
          text: 'open the full demo →',
        }),
      ],
    }),
    el('p', {
      class: 'home-iframe-caption',
      text:
        'Live. Multiplayer. Other tabs on this URL are in there with you. Click and drive with WASD.',
    }),
  ],
})
root.appendChild(liveArena)

// ── Why three cards ────────────────────────────────────────────────────
const why = el('section', {
  class: 'home-why site-page',
  children: [
    el('h2', { class: 'home-h', text: 'why this stack' }),
    el('div', {
      class: 'home-card-grid',
      children: [
        whyCard(
          'no egress',
          'R2 has no egress fees. A Ferrari GLB cached at the edge serves to a million players for the price of storage. Most CDNs would bill five figures for the same traffic.',
        ),
        whyCard(
          'real multiplayer',
          'Durable Objects give each room a single-writer state machine. Open the demo in two tabs and the second car appears in the first. Same room everywhere on the planet.',
        ),
        whyCard(
          'server-authoritative combat',
          'The arena is a game, not a scene. Hitscan shooting, HP, kills, and a shared boss all resolve inside the Durable Object, so a client cannot award itself a kill. Fire rate is limited server-side.',
        ),
        whyCard(
          'one deploy',
          `Click the deploy button or run \`npx tiged ${brand.repoSlug} my-game\`. R2, Workers, DO, D1, KV are provisioned for you. Your domain. Your account. MIT.`,
        ),
      ],
    }),
  ],
})
root.appendChild(why)

// ── Decorative 3D racetrack band (visual only, no competing CTA) ─────────
const band = el('section', {
  class: 'home-band',
  attrs: { 'aria-hidden': 'true' },
  children: [
    el('img', {
      class: 'home-band-img',
      attrs: {
        src: '/brand/hero-racetrack.jpg',
        alt: '',
        loading: 'lazy',
        width: '1280',
        height: '720',
      },
    }),
  ],
})
root.appendChild(band)

// ── How three steps ────────────────────────────────────────────────────
const how = el('section', {
  class: 'home-how site-page',
  children: [
    el('h2', { class: 'home-h', text: 'how it works' }),
    el('ol', {
      class: 'home-steps',
      children: [
        stepItem(
          '1',
          'fork the stack',
          `Clone the repo or use \`npx tiged ${brand.repoSlug}\`. You get a Cloudflare Workers project with R2, DO, D1, KV pre-wired and a working multiplayer arena.`,
        ),
        stepItem(
          '2',
          'drop your assets',
          'Push your GLBs into R2 with `wrangler r2 object put` (or drop them on the demo page in dev). The Worker serves them with MIME, Range, ETag, and immutable cache headers.',
        ),
        stepItem(
          '3',
          'ship to your account',
          '`bun run deploy`. Your Worker is live on a Cloudflare custom domain. Your game is on the same edge that hosts ~20% of the internet. Free at any traffic.',
        ),
      ],
    }),
  ],
})
root.appendChild(how)

// ── Closer ─────────────────────────────────────────────────────────────
const closer = el('section', {
  class: 'home-closer site-page',
  children: [
    el('h2', { class: 'home-closer-h', text: 'wanna make a game on Cloudflare?' }),
    el('p', {
      class: 'home-closer-sub',
      text:
        'The demo and the install are the same code. Click deploy and you get the same stack on your own Cloudflare account in 90 seconds.',
    }),
    el('div', {
      class: 'home-closer-cta',
      children: [
        el('a', {
          class: 'home-cta-primary',
          attrs: {
            href: `https://deploy.workers.cloudflare.com/?url=${brand.repo}`,
            target: '_blank',
            rel: 'noreferrer',
          },
          text: 'deploy this stack →',
        }),
        el('a', {
          class: 'home-cta-secondary',
          attrs: { href: '/install' },
          text: 'see install options',
        }),
      ],
    }),
  ],
})
root.appendChild(closer)

// ── Footer ─────────────────────────────────────────────────────────────
root.appendChild(buildFooter())

// ───────────────────────────────────────────────────────────────────────
function whyCard(title: string, text: string): HTMLElement {
  return el('div', {
    class: 'home-card',
    children: [
      el('h3', { class: 'home-card-h', text: title }),
      el('p', { class: 'home-card-p', text }),
    ],
  })
}

function stepItem(num: string, title: string, text: string): HTMLElement {
  return el('li', {
    class: 'home-step',
    children: [
      el('span', { class: 'home-step-num', text: num }),
      el('div', {
        class: 'home-step-body',
        children: [
          el('h3', { class: 'home-step-h', text: title }),
          el('p', { class: 'home-step-p', text }),
        ],
      }),
    ],
  })
}
