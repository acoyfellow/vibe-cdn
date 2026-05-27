// vibe-cdn local demo entry. Composes seven big panels with kid-friendly
// statuses. Each panel is self-contained and uses the worker on /health,
// /assets, /api, /ws.

import './style.css'
import { el } from './dom'
import { healthPanel } from './panels/health'
import { gltfPanel } from './panels/gltf'
import { rangePanel } from './panels/range'
import { lobbyPanel } from './panels/lobby'
import { leaderboardPanel } from './panels/leaderboard'
import { savesPanel } from './panels/saves'
import { costPanel } from './panels/cost'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

const header = el('header', {
  class: 'app-head',
  children: [
    el('div', {
      class: 'app-head-row',
      children: [
        el('h1', { text: 'vibe-cdn' }),
        el('span', { class: 'tag', text: '0.0.1' }),
      ],
    }),
    el('p', {
      class: 'app-sub',
      text: 'A Cloudflare game stack for heavy browser games. R2 assets, Worker CDN, Durable Object rooms, D1 scores, KV saves.',
    }),
    el('p', {
      class: 'first-edit',
      html:
        'First edit: drop a <code>.glb</code> in <code>fixtures/generated/demo/</code> as <code>triangle.glb</code>, then ' +
        '<code>bun run seed</code>. The model loader panel will show your model.',
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

root.appendChild(header)
root.appendChild(stack)
root.appendChild(footer)
