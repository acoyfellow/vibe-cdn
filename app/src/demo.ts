// /demo — the standalone interactive demo. Drop zone, arena, all the receipts.

import './style.css'
import './site/site.css'
import { el } from './dom'
import { buildHero } from './hero'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'
import { healthPanel } from './panels/health'
import { racePanel } from './panels/race'
import { rangePanel } from './panels/range'
import { lobbyPanel } from './panels/lobby'
import { leaderboardPanel } from './panels/leaderboard'
import { savesPanel } from './panels/saves'
import { costPanel } from './panels/cost'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

root.classList.add('site-shell')

root.appendChild(buildNav('demo'))

const main = el('main', {
  class: 'site-page',
  children: [
    buildHero(),
    el('section', {
      class: 'receipts-lead',
      children: [
        el('h2', { class: 'receipts-h', text: 'the receipts' }),
        el('p', {
          class: 'receipts-sub',
          text:
            'Every primitive on the stack, wired up and probed. Click around. Open a second tab for the arena.',
        }),
      ],
    }),
    el('section', {
      class: 'panels',
      children: [
        healthPanel(),
        racePanel(),
        rangePanel(),
        lobbyPanel(),
        leaderboardPanel(),
        savesPanel(),
        costPanel(),
      ],
    }),
  ],
})
root.appendChild(main)

root.appendChild(buildFooter())
