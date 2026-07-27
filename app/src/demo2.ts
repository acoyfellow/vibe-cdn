import './style.css'
import './site/site.css'
import { el } from './dom'
import { setTitle } from './brand'
import { buildNav } from './site/nav'
import { buildFooter } from './site/footer'
import { racePanel } from './panels/race'

const root = document.getElementById('app')
if (!root) throw new Error('#app missing')

setTitle('living arena')
root.classList.add('site-shell')

root.appendChild(buildNav('demo'))

function mechanic(num: string, title: string, text: string): HTMLElement {
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

const main = el('main', {
  class: 'site-page',
  children: [
    el('section', {
      class: 'receipts-lead',
      children: [
        el('h2', { class: 'receipts-h', text: 'the living arena' }),
        el('p', {
          class: 'receipts-sub',
          text:
            'The arena is not read-only. Drop a model and everyone drives it. A boss lives on the server and chases you. The leaderboard reshapes the world. Open a second tab to see it sync.',
        }),
      ],
    }),
    el('section', { class: 'panels', children: [racePanel()] }),
    el('section', {
      class: 'home-how site-page',
      children: [
        el('h2', { class: 'home-h', text: 'three things to try' }),
        el('ol', {
          class: 'home-steps',
          children: [
            mechanic(
              '1',
              'drop & drive',
              'Drag a .glb onto the arena. It uploads to R2, then spawns in front of your car as a shared object. Every visitor on this URL sees it within one network tick.',
            ),
            mechanic(
              '2',
              'room boss',
              'Press Spawn Boss. A red actor appears and hunts the nearest player. It runs inside the Durable Object, not in any browser, so it never disconnects and everyone sees the same chase.',
            ),
            mechanic(
              '3',
              'leaderboard physics',
              'The player with the most laps becomes the leader. Their car turns gold and grows. The D1 leaderboard is not a table beside the game; it changes the game.',
            ),
          ],
        }),
      ],
    }),
  ],
})
root.appendChild(main)

root.appendChild(buildFooter())
