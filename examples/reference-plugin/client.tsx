/**
 * Bookmarks — client entry.
 *
 * Loaded by the host shell's runtime plugin loader; `registerPlugin` runs as
 * a module side effect and contributes nav, client routes, and search hit
 * renderers into the shared shell runtime. The `routes` keys and `navItems`
 * must match the manifest's `contributes.routes` / `contributes.nav` so the
 * sidebar exists before this bundle loads.
 */
import { registerPlugin } from '@makinbakin/sdk'
import { BookmarksPage } from './components/bookmarks-page'

registerPlugin({
  id: 'reference-bookmarks',
  navItems: [
    { id: 'reference-bookmarks', label: 'Bookmarks', icon: 'Bookmark', href: '/reference-bookmarks', order: 200 },
  ],
  routes: {
    '/reference-bookmarks': BookmarksPage,
  },
  search: {
    // How this plugin's documents render in the global ⌘K overlay. The key
    // is the content-type table registered server-side.
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
})
