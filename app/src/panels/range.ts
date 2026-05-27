// Range stress panel. Slices a large asset using HTTP Range requests and
// shows latency / status / cf-cache-status per chunk. Run it twice and watch
// the edge warm up: MISS -> HIT.

import { fetchRange } from '../api'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const ASSET_PATH = '/assets/demo/large.bin'
const DEFAULT_CHUNK = 1024 * 1024 // 1 MiB
const DEFAULT_PARALLEL = 4

export function rangePanel(): HTMLElement {
  const status = makeStatus()
  const log = el('div', { class: 'log' })
  const meta = el('div', { class: 'kv-grid' })
  const cacheBar = el('div', { class: 'cache-bar' })
  const table = el('table', { class: 'range-table' })

  const chunkInput = el('input', {
    class: 'text-input',
    attrs: { type: 'number', min: '1024', step: '1024', value: String(DEFAULT_CHUNK) },
  })
  const parallelInput = el('input', {
    class: 'text-input',
    attrs: { type: 'number', min: '1', max: '32', step: '1', value: String(DEFAULT_PARALLEL) },
  })

  const run = async (): Promise<void> => {
    setStatus(status, 'busy', 'probing…')
    meta.innerHTML = ''
    cacheBar.innerHTML = ''
    table.innerHTML = ''

    const head = await fetch(ASSET_PATH, { method: 'HEAD' })
    if (!head.ok) {
      setStatus(status, 'fail', `HEAD ${head.status}`)
      logLine(log, `HEAD ${ASSET_PATH} → ${head.status}`, 'fail')
      return
    }
    const size = Number(head.headers.get('content-length') ?? '0')
    const acceptRanges = head.headers.get('accept-ranges') ?? 'missing'
    const etag = head.headers.get('etag') ?? 'missing'
    const headCacheStatus = head.headers.get('cf-cache-status') ?? '—'

    meta.appendChild(rowEl('Asset', ASSET_PATH))
    meta.appendChild(rowEl('Size', `${size.toLocaleString()} bytes`))
    meta.appendChild(rowEl('Accept-Ranges', acceptRanges))
    meta.appendChild(rowEl('ETag', etag))
    meta.appendChild(rowEl('HEAD cf-cache-status', headCacheStatus))

    if (size === 0) {
      setStatus(status, 'fail', 'size 0')
      return
    }

    const chunk = Math.max(1024, Number(chunkInput.value) || DEFAULT_CHUNK)
    const parallel = Math.max(1, Math.min(32, Number(parallelInput.value) || DEFAULT_PARALLEL))

    const ranges: { start: number; end: number; index: number }[] = []
    for (let i = 0, idx = 0; i < size; i += chunk, idx++) {
      ranges.push({ start: i, end: Math.min(size - 1, i + chunk - 1), index: idx })
    }

    // Cache visualization: one cell per chunk in their final order.
    for (const r of ranges) {
      cacheBar.appendChild(
        el('span', { class: 'cache-cell', attrs: { 'data-index': String(r.index), title: `chunk ${r.index}` } }),
      )
    }

    table.appendChild(
      el('thead', {
        children: [
          el('tr', {
            children: [
              el('th', { text: '#' }),
              el('th', { text: 'range' }),
              el('th', { text: 'status' }),
              el('th', { text: 'cf-cache' }),
              el('th', { text: 'age' }),
              el('th', { text: 'bytes' }),
              el('th', { text: 'ms' }),
            ],
          }),
        ],
      }),
    )
    const tbody = el('tbody')
    table.appendChild(tbody)

    setStatus(status, 'busy', `${ranges.length} chunks @ ${parallel} parallel…`)

    let totalBytes = 0
    let okCount = 0
    let failCount = 0
    let maxMs = 0
    const cacheCounts = new Map<string, number>()
    const t0 = performance.now()

    let cursor = 0
    const next = async (): Promise<void> => {
      while (cursor < ranges.length) {
        const i = cursor++
        const r = ranges[i]!
        const result = await fetchRange(ASSET_PATH, r.start, r.end)
        totalBytes += result.bytes
        maxMs = Math.max(maxMs, result.ms)
        const partialOk = result.status === 206 && result.bytes === r.end - r.start + 1
        if (partialOk) okCount++
        else failCount++

        const tag = (result.cacheStatus ?? 'none').toLowerCase()
        cacheCounts.set(tag, (cacheCounts.get(tag) ?? 0) + 1)
        const cell = cacheBar.querySelector(`.cache-cell[data-index="${r.index}"]`) as HTMLElement | null
        if (cell) cell.dataset.cache = tag

        tbody.appendChild(
          el('tr', {
            class: partialOk ? 'ok' : 'fail',
            children: [
              el('td', { text: String(r.index) }),
              el('td', { text: `${r.start}-${r.end}` }),
              el('td', { text: String(result.status) }),
              el('td', { text: result.cacheStatus ?? '—' }),
              el('td', { text: result.age ?? '—' }),
              el('td', { text: String(result.bytes) }),
              el('td', { text: String(result.ms) }),
            ],
          }),
        )
      }
    }

    await Promise.all(Array.from({ length: parallel }, () => next()))

    const elapsed = Math.round(performance.now() - t0)
    const throughput = totalBytes && elapsed ? Math.round((totalBytes / elapsed) * 1000 / 1024) : 0

    const cacheBreakdown = Array.from(cacheCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join('  ')
    meta.appendChild(rowEl('Chunks', `${okCount} ok / ${failCount} fail`))
    meta.appendChild(rowEl('Total bytes', `${totalBytes.toLocaleString()}`))
    meta.appendChild(rowEl('Wall time', `${elapsed} ms`))
    meta.appendChild(rowEl('Throughput', `${throughput.toLocaleString()} KiB/s`))
    meta.appendChild(rowEl('Cache breakdown', cacheBreakdown || '—'))

    if (failCount === 0 && totalBytes === size) {
      setStatus(status, 'ok', `${okCount}/${ranges.length} ok in ${elapsed} ms`)
      logLine(log, `${okCount} ranges OK, ${totalBytes} bytes, ${cacheBreakdown}`, 'ok')
    } else {
      setStatus(status, 'fail', `${failCount} failed`)
      logLine(log, `${failCount} ranges failed; got ${totalBytes} of ${size} bytes`, 'fail')
    }
  }

  const runTwice = async (): Promise<void> => {
    await run()
    await new Promise((r) => setTimeout(r, 500))
    logLine(log, '— second pass (watch the edge warm up) —', 'info')
    await run()
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', {
        class: 'row',
        children: [
          el('label', { class: 'field', children: [el('span', { text: 'chunk bytes' }), chunkInput] }),
          el('label', { class: 'field', children: [el('span', { text: 'parallel' }), parallelInput] }),
          bigButton('Run', run),
          bigButton('Run twice (cold → warm)', runTwice),
          status,
        ],
      }),
      cacheBar,
      meta,
      table,
      log,
    ],
  })

  return panel(
    '3. Range stress (HTTP byte ranges + edge cache)',
    `Slices ${ASSET_PATH} into Range chunks. Each cell is colored by cf-cache-status. Run twice and watch the edge warm up: MISS, EXPIRED, REVALIDATED → HIT.`,
    body,
  )
}

function rowEl(k: string, v: string): HTMLElement {
  return el('div', {
    class: 'kv-row',
    children: [el('span', { class: 'kv-key', text: k }), el('span', { class: 'kv-val', text: v })],
  })
}
