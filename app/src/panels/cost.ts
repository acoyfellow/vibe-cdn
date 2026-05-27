import type { CostEstimate } from '../../../src/shared/pricing'
import { getJson } from '../api'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

type EstResp = { ok: boolean; estimate: CostEstimate }

type FieldDef = {
  key: 'bundleMb' | 'monthlyPlayers' | 'sessionsPerPlayer' | 'cacheHitRate' | 'storageGb'
  label: string
  value: string
  min: string
  max: string
  step: string
}

const FIELDS: FieldDef[] = [
  { key: 'bundleMb', label: 'Game size (MB)', value: '150', min: '1', max: '5000', step: '1' },
  { key: 'monthlyPlayers', label: 'Players / month', value: '10000', min: '0', max: '10000000', step: '100' },
  { key: 'sessionsPerPlayer', label: 'Sessions / player', value: '3', min: '1', max: '100', step: '1' },
  { key: 'cacheHitRate', label: 'Cache hit rate (0–1)', value: '0.95', min: '0', max: '1', step: '0.01' },
  { key: 'storageGb', label: 'Storage (GB)', value: '10', min: '0', max: '10000', step: '1' },
]

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtBig(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(0)
}

export function costPanel(): HTMLElement {
  const status = makeStatus()
  const log = el('div', { class: 'log' })
  const out = el('div', { class: 'kv-grid' })

  const inputs: Record<string, HTMLInputElement> = {}
  const form = el('div', { class: 'form-grid' })
  for (const f of FIELDS) {
    const input = el('input', {
      class: 'text-input',
      attrs: {
        type: 'number',
        min: f.min,
        max: f.max,
        step: f.step,
        value: f.value,
      },
    })
    inputs[f.key] = input
    form.appendChild(
      el('label', { class: 'field', children: [el('span', { text: f.label }), input] }),
    )
  }

  const estimate = async () => {
    setStatus(status, 'busy', 'estimating…')
    const params = new URLSearchParams()
    for (const f of FIELDS) params.set(f.key, inputs[f.key]!.value)
    const res = await getJson<EstResp>(`/api/cost/estimate?${params.toString()}`)
    if (res.ok && res.data?.ok) {
      const e = res.data.estimate
      out.innerHTML = ''
      const rows: [string, string][] = [
        ['Monthly asset reads', fmtBig(e.monthlyAssetReads)],
        ['Cached delivery (GB)', e.cachedDeliveryGb.toFixed(2)],
        ['Origin reads (GB)', e.originReadGb.toFixed(2)],
        ['R2 storage', fmtMoney(e.r2StorageDollars)],
        ['R2 class B requests', fmtMoney(e.r2ClassBDollars)],
        ['Rough monthly total', fmtMoney(e.roughTotalDollars)],
      ]
      for (const [k, v] of rows) {
        out.appendChild(
          el('div', {
            class: 'kv-row',
            children: [el('span', { class: 'kv-key', text: k }), el('span', { class: 'kv-val', text: v })],
          }),
        )
      }
      out.appendChild(el('p', { class: 'help', text: e.note }))
      setStatus(status, 'ok', `estimated in ${res.ms} ms`)
      logLine(log, `GET /api/cost/estimate → ${fmtMoney(e.roughTotalDollars)}`, 'ok')
    } else {
      setStatus(status, 'fail', `failed (${res.status || 'no response'})`)
      logLine(log, `cost estimate failed: ${res.error ?? res.status}`, 'fail')
    }
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      form,
      el('div', { class: 'row', children: [bigButton('Estimate cost', estimate), status] }),
      out,
      log,
    ],
  })

  queueMicrotask(estimate)

  return panel('7. Cost estimator', 'Asks the worker /api/cost/estimate with your numbers. Tweak and try again.', body)
}
