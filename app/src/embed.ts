// /embed/arena — a minimal full-bleed view of just the arena, suitable
// for <iframe src="https://vibe-cdn.coey.dev/embed/arena">.
//
// No drop zone, no stats ticker, no panels, no closer — just the canvas,
// the HUD, and a tiny "vibe-cdn" attribution badge that links to the
// main site. Same Durable Object room as the main page, so visitors who
// see the embed are in the same lobby as visitors on vibe-cdn.coey.dev.

import './style.css'
import './embed.css'
import { el } from './dom'
import { brand } from './brand'
import { racePanel } from './panels/race'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

root.classList.add('embed-mode')

const wrapper = el('div', {
  class: 'embed-wrapper',
  children: [
    racePanel(),
    el('a', {
      class: 'embed-attr',
      attrs: { href: brand.url, target: '_blank', rel: 'noreferrer' },
      children: [
        el('span', { class: 'embed-attr-mark', text: brand.mark }),
        el('span', { class: 'embed-attr-text', text: brand.wordmark }),
      ],
    }),
  ],
})

root.appendChild(wrapper)
