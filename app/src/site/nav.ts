// Shared site nav. Appears at the top of every page.
//
// Usage:  appendNav(rootEl, 'home' | 'demo' | 'docs' | 'install')

import { el } from '../dom'
import { brand } from '../brand'

type ActivePage = 'home' | 'demo' | 'docs' | 'install'

const LINKS: { label: string; href: string; page: ActivePage }[] = [
  { label: 'demo', href: '/demo', page: 'demo' },
  { label: 'docs', href: '/docs', page: 'docs' },
]

export function buildNav(active?: ActivePage): HTMLElement {
  return el('header', {
    class: 'site-nav',
    children: [
      el('a', {
        class: 'site-nav-brand',
        attrs: { href: '/' },
        children: [
          el('span', { class: 'site-nav-mark', text: brand.mark }),
          el('span', { class: 'site-nav-wordmark', text: brand.wordmark }),
        ],
      }),
      el('nav', {
        class: 'site-nav-links',
        children: [
          ...LINKS.map((link) =>
            el('a', {
              class: 'site-nav-link' + (active === link.page ? ' site-nav-link-active' : ''),
              attrs: { href: link.href },
              text: link.label,
            }),
          ),
          el('a', {
            class: 'site-nav-link site-nav-github',
            attrs: { href: brand.repo, target: '_blank', rel: 'noreferrer' },
            text: 'github',
          }),
          el('a', {
            class: 'site-nav-cta' + (active === 'install' ? ' site-nav-cta-active' : ''),
            attrs: { href: '/install' },
            text: 'install',
          }),
        ],
      }),
    ],
  })
}
