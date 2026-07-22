import '@makinbakin/sdk/styles.css'

import { createRoot } from 'react-dom/client'
import {
  DEFAULT_PLUGIN_UI_FIXTURE,
  PluginUiFixtureHost,
} from '@makinbakin/sdk/testing/ui'
import { referenceBookmarksRegistration } from '../client-registration'

const fixture = {
  ...DEFAULT_PLUGIN_UI_FIXTURE,
  route: '/reference-bookmarks',
  randomSeed: 'reference-bookmarks-ui',
  network: [
    {
      path: '/api/plugins/reference-bookmarks/',
      status: 200,
      json: {
        bookmarks: [
          {
            id: 'bookmark-bun-docs',
            url: 'https://bun.sh/docs',
            title: 'Bun documentation',
            tags: ['runtime', 'docs'],
            note: 'The runtime reference used by this plugin.',
            createdAt: '2026-01-15T11:45:00.000Z',
          },
          {
            id: 'bookmark-bakin-sdk',
            url: 'https://makinbakin.com/docs/extending/sdk/',
            title: 'Bakin SDK guide for plugin builders',
            tags: ['bakin', 'plugins'],
            createdAt: '2026-01-14T18:00:00.000Z',
          },
        ],
      },
    },
  ],
} as const

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={fixture}
    registrations={[referenceBookmarksRegistration]}
    slots={[{ name: 'home-widget', label: 'Home widget contribution' }]}
  />,
)
