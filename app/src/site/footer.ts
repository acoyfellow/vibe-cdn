// Shared site footer. Appears at the bottom of every page.

import { el } from '../dom'
import { brand } from '../brand'

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
      { label: 'architecture', href: `${brand.repo}/blob/main/docs/architecture.md` },
      { label: 'costs', href: `${brand.repo}/blob/main/docs/costs.md` },
      { label: 'deploy', href: `${brand.repo}/blob/main/docs/deploy.md` },
    ],
  },
  {
    heading: 'source',
    items: [
      { label: 'github', href: brand.repo },
      { label: 'license', href: `${brand.repo}/blob/main/LICENSE` },
      { label: 'author', href: brand.author },
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
          el('span', { class: 'site-foot-meta', text: `made on Cloudflare · MIT · ${brand.version}` }),
          el('span', { class: 'site-foot-egress', text: 'egress: $0' }),
        ],
      }),
    ],
  })
}
