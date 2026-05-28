// vibe-cdn entry. The hero is the product (drop zone + live stats), the
// panels below are the receipts.

import './style.css'
import { el } from './dom'
import { buildHero } from './hero'
import { healthPanel } from './panels/health'
import { gltfPanel } from './panels/gltf'
import { racePanel } from './panels/race'
import { rangePanel } from './panels/range'
import { lobbyPanel } from './panels/lobby'
import { leaderboardPanel } from './panels/leaderboard'
import { savesPanel } from './panels/saves'
import { costPanel } from './panels/cost'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

const hero = buildHero()

const receiptsLead = el('section', {
  class: 'receipts-lead',
  children: [
    el('h2', { class: 'receipts-h', text: 'the receipts' }),
    el('p', {
      class: 'receipts-sub',
      text:
        'Every primitive on the stack, wired up and probed. Click around. Open a second tab for the lobby.',
    }),
  ],
})

const stack = el('main', {
  class: 'panels',
  children: [
    healthPanel(),
    racePanel(),
    gltfPanel(),
    rangePanel(),
    lobbyPanel(),
    leaderboardPanel(),
    savesPanel(),
    costPanel(),
  ],
})

const closer = el('section', {
  class: 'closer',
  children: [
    el('h2', { class: 'closer-h', text: 'wanna make a game on Cloudflare?' }),
    el('p', {
      class: 'closer-sub',
      text:
        'Everything you just clicked through is in one repo. Click deploy and you get the same stack on your own Cloudflare account in 90 seconds. R2 bucket, Worker, Durable Object, D1, KV, custom domain ready to wire. MIT.',
    }),
    el('div', {
      class: 'closer-cta',
      children: [
        el('a', {
          class: 'cta-deploy closer-deploy',
          attrs: {
            href: 'https://deploy.workers.cloudflare.com/?url=https://github.com/acoyfellow/vibe-cdn',
            target: '_blank',
            rel: 'noreferrer',
          },
          text: 'deploy this stack →',
        }),
        el('a', {
          class: 'closer-secondary',
          attrs: {
            href: 'https://github.com/acoyfellow/vibe-cdn',
            target: '_blank',
            rel: 'noreferrer',
          },
          text: 'read the source',
        }),
      ],
    }),
  ],
})

const footer = el('footer', {
  class: 'app-foot',
  children: [
    el('div', {
      class: 'foot-links',
      children: [
        el('a', {
          attrs: { href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/architecture.md', target: '_blank', rel: 'noreferrer' },
          text: 'Architecture',
        }),
        el('a', {
          attrs: { href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/costs.md', target: '_blank', rel: 'noreferrer' },
          text: 'Costs',
        }),
        el('a', {
          attrs: { href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/deploy.md', target: '_blank', rel: 'noreferrer' },
          text: 'Deploy',
        }),
        el('a', {
          attrs: { href: 'https://github.com/acoyfellow/vibe-cdn', target: '_blank', rel: 'noreferrer' },
          text: 'Source',
        }),
      ],
    }),
    el('p', { class: 'foot-meta', text: 'made on Cloudflare. MIT.' }),
  ],
})

root.appendChild(hero)
root.appendChild(receiptsLead)
root.appendChild(stack)
root.appendChild(closer)
root.appendChild(footer)
