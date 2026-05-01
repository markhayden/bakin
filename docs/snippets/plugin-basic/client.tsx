import { registerPlugin } from '@bakin/sdk'

function DocsBasicPage() {
  return <div>Hello from a Bakin plugin.</div>
}

registerPlugin({
  id: 'docs-basic',
  navItems: [
    {
      id: 'docs-basic',
      label: 'Docs Basic',
      icon: 'Puzzle',
      href: '/docs-basic',
      order: 100,
    },
  ],
  routes: {
    '/docs-basic': DocsBasicPage,
  },
})
