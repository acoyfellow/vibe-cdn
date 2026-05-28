import type { Score } from '../../../src/shared/contracts'
import { getJson, postJson } from '../api'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

type ListResp = { ok: boolean; scores: Score[] }
type PostResp = { ok: boolean; score: Score }

export function leaderboardPanel(): HTMLElement {
  const status = makeStatus()
  const log = el('div', { class: 'log' })
  const list = el('ol', { class: 'score-list' })

  const nameInput = el('input', {
    class: 'text-input',
    attrs: { type: 'text', placeholder: 'your name', maxlength: '24', value: 'kiddo' },
  })
  const scoreInput = el('input', {
    class: 'text-input',
    attrs: { type: 'number', min: '0', step: '1', value: '100' },
  })

  const refresh = async () => {
    setStatus(status, 'busy', 'loading…')
    const res = await getJson<ListResp>('/api/scores')
    if (res.ok && res.data?.ok) {
      list.innerHTML = ''
      const scores = res.data.scores ?? []
      if (scores.length === 0) {
        list.appendChild(el('li', { class: 'empty', text: 'no scores yet — submit one!' }))
      }
      for (const s of scores) {
        list.appendChild(
          el('li', {
            class: 'score-row',
            children: [
              el('span', { class: 'score-name', text: s.name }),
              el('span', { class: 'score-value', text: String(s.score) }),
            ],
          }),
        )
      }
      setStatus(status, 'ok', `${scores.length} scores in ${res.ms} ms`)
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `GET /api/scores failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const submit = async () => {
    const name = nameInput.value.trim() || 'player'
    const score = Math.max(0, Math.floor(Number(scoreInput.value) || 0))
    setStatus(status, 'busy', 'submitting…')
    const res = await postJson<PostResp>('/api/scores', { name, score })
    if (res.ok && res.data?.ok) {
      logLine(log, `Saved ${name} → ${score}`, 'ok')
      await refresh()
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `POST /api/scores failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', {
        class: 'row',
        children: [
          el('label', { class: 'field', children: [el('span', { text: 'name' }), nameInput] }),
          el('label', { class: 'field', children: [el('span', { text: 'score' }), scoreInput] }),
          bigButton('Submit score', submit),
          bigButton('Refresh', refresh),
          status,
        ],
      }),
      list,
      log,
    ],
  })

  queueMicrotask(refresh)

  return panel(
    '5. Leaderboard (D1)',
    'Lap times from the Mini Race above land here automatically, scored so faster laps rank higher. POST your own to /api/scores to join the leaderboard.',
    body,
  )
}
