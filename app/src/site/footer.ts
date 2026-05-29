// Shared site footer. Appears at the bottom of every page.

import { el } from '../dom'

const LINK_GROUPS: { heading: string; items: { label: string; href: string }[] }[] = [
  {
    heading: 'product',
    items: [
      { label: 'demo', href: '/demo' },
      { label: 'install', href: '/install' },
      { label: 'embed', href: '/embed/arena' },
    ],
  },
  {
    heading: 'docs',
    items: [
      { label: 'architecture', href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/architecture.md' },
      { label: 'costs', href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/costs.md' },
      { label: 'deploy', href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/docs/deploy.md' },
    ],
  },
  {
    heading: 'source',
    items: [
      { label: 'github', href: 'https://github.com/acoyfellow/vibe-cdn' },
      { label: 'license', href: 'https://github.com/acoyfellow/vibe-cdn/blob/main/LICENSE' },
      { label: 'author', href: 'https://x.com/acoyfellow' },
    ],
  },
]

export function buildFooter(): HTMLElement {
  return el('footer', {
    class: 'site-foot',
    children: [
      el('div', {
        class: 'site-foot-grid',
        children: LINK_GROUPS.map((group) =>
          el('div', {
            class: 'site-foot-col',
            children: [
              el('h4', { class: 'site-foot-h', text: group.heading }),
              el('ul', {
                class: 'site-foot-list',
                children: group.items.map((item) =>
                  el('li', {
                    children: [
                      el('a', {
                        class: 'site-foot-link',
                        attrs: item.href.startsWith('http')
                          ? { href: item.href, target: '_blank', rel: 'noreferrer' }
                          : { href: item.href },
                        text: item.label,
                      }),
                    ],
                  }),
                ),
              }),
            ],
          }),
        ),
      }),
      el('div', {
        class: 'site-foot-bar',
        children: [
          el('span', { class: 'site-foot-meta', text: 'made on Cloudflare · MIT · 0.1.0' }),
          el('span', { class: 'site-foot-egress', text: 'egress: $0' }),
        ],
      }),
    ],
  })
}
