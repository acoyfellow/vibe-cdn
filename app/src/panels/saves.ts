import { getJson, putJson } from '../api'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

type SaveResp = { ok: boolean; player: string; slot: string; value: unknown }

const PATH = '/api/saves/local/slot-a'

export function savesPanel(): HTMLElement {
  const status = makeStatus()
  const log = el('div', { class: 'log' })

  const textarea = el('textarea', {
    class: 'json-area',
    attrs: { rows: '6', spellcheck: 'false' },
  })
  textarea.value = JSON.stringify({ level: 1, coins: 7, hat: 'wizard' }, null, 2)

  const load = async () => {
    setStatus(status, 'busy', 'loading…')
    const res = await getJson<SaveResp>(PATH)
    if (res.ok && res.data?.ok) {
      const value = res.data.value ?? null
      textarea.value = JSON.stringify(value, null, 2)
      setStatus(status, 'ok', `loaded in ${res.ms} ms`)
      logLine(log, `GET ${PATH} → ${value ? 'has value' : 'empty'}`, 'ok')
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `GET ${PATH} failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const save = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(textarea.value)
    } catch (err) {
      setStatus(status, 'fail', 'invalid JSON')
      logLine(log, `Can't save — JSON parse error: ${(err as Error).message}`, 'fail')
      return
    }
    setStatus(status, 'busy', 'saving…')
    const res = await putJson<SaveResp>(PATH, parsed)
    if (res.ok && res.data?.ok) {
      setStatus(status, 'ok', `saved in ${res.ms} ms`)
      logLine(log, `PUT ${PATH} → saved`, 'ok')
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `PUT ${PATH} failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('p', {
        class: 'help',
        text: 'Edit the JSON below, click Save, then Load it back. This proves KV is working.',
      }),
      textarea,
      el('div', {
        class: 'row',
        children: [bigButton('Save', save), bigButton('Load', load), status],
      }),
      log,
    ],
  })

  queueMicrotask(load)

  return panel('6. Game saves (KV)', `PUT/GET ${PATH} as JSON. Try refreshing the page — it sticks.`, body)
}
