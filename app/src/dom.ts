// Tiny DOM helpers. Keeps panels short and readable for kids.

export type ElProps = {
  class?: string
  id?: string
  text?: string
  html?: string
  attrs?: Record<string, string>
  on?: Record<string, (ev: Event) => void>
  children?: (HTMLElement | string | null | undefined)[]
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.id) node.id = props.id
  if (props.text !== undefined) node.textContent = props.text
  if (props.html !== undefined) node.innerHTML = props.html
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v)
  }
  if (props.on) {
    for (const [k, v] of Object.entries(props.on)) node.addEventListener(k, v)
  }
  if (props.children) {
    for (const child of props.children) {
      if (child == null) continue
      if (typeof child === 'string') node.appendChild(document.createTextNode(child))
      else node.appendChild(child)
    }
  }
  return node
}

export type Status = 'idle' | 'ok' | 'fail' | 'busy'

export function setStatus(dot: HTMLElement, status: Status, label?: string): void {
  dot.dataset.status = status
  dot.className = `status status-${status}`
  if (label !== undefined) dot.textContent = label
}

export function makeStatus(initial: Status = 'idle', label = 'idle'): HTMLSpanElement {
  const span = el('span', { class: `status status-${initial}`, text: label })
  span.dataset.status = initial
  return span
}

export function panel(title: string, subtitle: string, body: HTMLElement): HTMLElement {
  return el('section', {
    class: 'panel',
    children: [
      el('header', {
        class: 'panel-head',
        children: [
          el('h2', { text: title }),
          el('p', { class: 'panel-sub', text: subtitle }),
        ],
      }),
      body,
    ],
  })
}

export function bigButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = el('button', {
    class: 'big-btn',
    text: label,
    on: {
      click: async () => {
        if (btn.disabled) return
        btn.disabled = true
        try {
          await onClick()
        } finally {
          btn.disabled = false
        }
      },
    },
  })
  return btn
}

export function logLine(host: HTMLElement, text: string, kind: 'ok' | 'fail' | 'info' = 'info'): void {
  const line = el('div', { class: `log-line log-${kind}`, text })
  host.appendChild(line)
  // Keep the log short: only the last 60 lines.
  while (host.childElementCount > 60) host.removeChild(host.firstChild!)
  host.scrollTop = host.scrollHeight
}
