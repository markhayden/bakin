import type { PluginRegistration } from '@makinbakin/sdk'
import { BookmarksPage } from './components/bookmarks-page'
import { BookmarksWidget } from './components/bookmarks-widget'

import './styles.css'

/** Export the production registration so browser fixtures exercise the real contract. */
export const referenceBookmarksRegistration = {
  id: 'reference-bookmarks',
  routes: { '/reference-bookmarks': BookmarksPage },
  slots: { 'home-widget': BookmarksWidget },
  search: {
    hitRenderers: {
      'reference-bookmarks': (hit) => ({
        title: String(hit.fields.title ?? hit.id),
        subtitle: String(hit.fields.url ?? ''),
        href: '/reference-bookmarks',
        icon: 'bookmark',
        meta: Array.isArray(hit.fields.tags) ? hit.fields.tags.join(' · ') : undefined,
      }),
    },
  },
} satisfies PluginRegistration
