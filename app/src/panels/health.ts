import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'
import { getJson } from '../api'

type HealthShape = {
  ok?: boolean
  name?: string
  version?: string
  bindings?: { r2?: boolean; d1?: boolean; kv?: boolean; durableObjects?: boolean }
}

export function healthPanel(): HTMLElement {
  const status = makeStatus('idle', 'not checked')
  const log = el('div', { class: 'log' })
  const grid = el('div', { class: 'kv-grid' })

  const refresh = async () => {
    setStatus(status, 'busy', 'checking…')
    grid.innerHTML = ''
    const res = await getJson<HealthShape>('/health')
    if (res.ok && res.data?.ok) {
      setStatus(status, 'ok', `healthy in ${res.ms} ms`)
      logLine(log, `GET /health → 200 in ${res.ms} ms`, 'ok')
      const b = res.data.bindings ?? {}
      const rows: [string, boolean | undefined][] = [
        ['R2 (assets)', b.r2],
        ['D1 (scores)', b.d1],
        ['KV (saves)', b.kv],
        ['Durable Objects (lobby)', b.durableObjects],
      ]
      for (const [name, ok] of rows) {
        grid.appendChild(
          el('div', {
            class: 'kv-row',
            children: [
              el('span', { class: 'kv-key', text: name }),
              el('span', {
                class: ok ? 'status status-ok' : 'status status-fail',
                text: ok ? 'bound' : 'missing',
              }),
            ],
          }),
        )
      }
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `GET /health failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', {
        class: 'row',
        children: [bigButton('Check health', refresh), status],
      }),
      grid,
      log,
    ],
  })

  // Auto-run on load so the first paint is informative.
  queueMicrotask(refresh)

  return panel('1. Is the server alive?', 'Pings /health and shows which Cloudflare bindings are wired up.', body)
}
