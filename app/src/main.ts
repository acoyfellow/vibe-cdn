// vibe-cdn entry. The hero is the product (drop zone + live stats), the
// panels below are the receipts.

import './style.css'
import { el } from './dom'
import { buildHero } from './hero'
import { healthPanel } from './panels/health'
import { gltfPanel } from './panels/gltf'
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
    gltfPanel(),
    rangePanel(),
    lobbyPanel(),
    leaderboardPanel(),
    savesPanel(),
    costPanel(),
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
root.appendChild(footer)
