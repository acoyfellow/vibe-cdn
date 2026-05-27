// Range stress panel. Slices a large asset using HTTP Range requests and
// shows latency / status / total bytes per chunk. Proves the worker honors
// `Range:`, returns 206 Partial Content, and the asset is reachable in pieces.

import { fetchRange } from '../api'
import { bigButton, el, logLine, makeStatus, panel, setStatus } from '../dom'

const ASSET_PATH = '/assets/demo/large.bin'
const DEFAULT_CHUNK = 1024 * 1024 // 1 MiB
const DEFAULT_PARALLEL = 4

export function rangePanel(): HTMLElement {
  const status = makeStatus()
  const log = el('div', { class: 'log' })
  const meta = el('div', { class: 'kv-grid' })
  const table = el('table', { class: 'range-table' })

  const chunkInput = el('input', {
    class: 'text-input',
    attrs: { type: 'number', min: '1024', step: '1024', value: String(DEFAULT_CHUNK) },
  })
  const parallelInput = el('input', {
    class: 'text-input',
    attrs: { type: 'number', min: '1', max: '32', step: '1', value: String(DEFAULT_PARALLEL) },
  })

  const run = async () => {
    setStatus(status, 'busy', 'probing…')
    meta.innerHTML = ''
    table.innerHTML = ''

    // 1. HEAD the asset for size + accept-ranges.
    const head = await fetch(ASSET_PATH, { method: 'HEAD' })
    if (!head.ok) {
      setStatus(status, 'fail', `HEAD ${head.status}`)
      logLine(log, `HEAD ${ASSET_PATH} → ${head.status}`, 'fail')
      return
    }
    const size = Number(head.headers.get('content-length') ?? '0')
    const acceptRanges = head.headers.get('accept-ranges') ?? 'missing'
    const etag = head.headers.get('etag') ?? 'missing'

    meta.appendChild(rowEl('Asset', ASSET_PATH))
    meta.appendChild(rowEl('Size', `${size.toLocaleString()} bytes`))
    meta.appendChild(rowEl('Accept-Ranges', acceptRanges))
    meta.appendChild(rowEl('ETag', etag))

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

    table.appendChild(
      el('thead', {
        children: [
          el('tr', {
            children: [
              el('th', { text: '#' }),
              el('th', { text: 'range' }),
              el('th', { text: 'status' }),
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
    let firstOk = 0
    let firstFail = 0
    let maxMs = 0
    const t0 = performance.now()

    // Simple parallel worker pool.
    let cursor = 0
    const next = async (): Promise<void> => {
      while (cursor < ranges.length) {
        const i = cursor++
        const r = ranges[i]!
        const result = await fetchRange(ASSET_PATH, r.start, r.end)
        totalBytes += result.bytes
        maxMs = Math.max(maxMs, result.ms)
        const partialOk = result.status === 206 && result.bytes === r.end - r.start + 1
        if (partialOk) firstOk++
        else firstFail++
        tbody.appendChild(
          el('tr', {
            class: partialOk ? 'ok' : 'fail',
            children: [
              el('td', { text: String(r.index) }),
              el('td', { text: `${r.start}-${r.end}` }),
              el('td', { text: String(result.status) }),
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

    meta.appendChild(rowEl('Chunks', `${firstOk} ok / ${firstFail} fail`))
    meta.appendChild(rowEl('Total bytes', `${totalBytes.toLocaleString()}`))
    meta.appendChild(rowEl('Wall time', `${elapsed} ms`))
    meta.appendChild(rowEl('Throughput', `${throughput.toLocaleString()} KiB/s`))

    if (firstFail === 0 && totalBytes === size) {
      setStatus(status, 'ok', `${firstOk}/${ranges.length} ok in ${elapsed} ms`)
      logLine(log, `${firstOk} ranges OK, ${totalBytes} bytes`, 'ok')
    } else {
      setStatus(status, 'fail', `${firstFail} failed`)
      logLine(log, `${firstFail} ranges failed; got ${totalBytes} of ${size} bytes`, 'fail')
    }
  }

  const body = el('div', {
    class: 'panel-body',
    children: [
      el('div', {
        class: 'row',
        children: [
          el('label', { class: 'field', children: [el('span', { text: 'chunk bytes' }), chunkInput] }),
          el('label', { class: 'field', children: [el('span', { text: 'parallel' }), parallelInput] }),
          bigButton('Run range stress', run),
          status,
        ],
      }),
      meta,
      table,
      log,
    ],
  })

  return panel(
    '3. Range stress (HTTP byte ranges)',
    `Slices ${ASSET_PATH} into chunks with Range: headers. Every chunk should come back as 206 Partial Content.`,
    body,
  )
}

function rowEl(k: string, v: string): HTMLElement {
  return el('div', {
    class: 'kv-row',
    children: [el('span', { class: 'kv-key', text: k }), el('span', { class: 'kv-val', text: v })],
  })
}
