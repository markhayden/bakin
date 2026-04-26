import { defineConfig, passthroughImageService } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://docs.makinbakin.com',
  image: {
    service: passthroughImageService(),
  },
  integrations: [
    starlight({
      title: 'Bakin Docs',
      logo: {
        src: './src/assets/bakin-logo.svg',
        alt: 'Bakin',
      },
      customCss: ['./src/styles/docs.css'],
      defaultLocale: 'root',
      editLink: {
        baseUrl: 'https://github.com/madeinwyo/bakin/edit/main/apps/docs/src/content/docs/',
      },
      lastUpdated: true,
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/madeinwyo/bakin',
        },
      ],
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Overview', slug: 'start/overview' },
            { label: 'Documentation Plan', slug: 'start/documentation-plan' },
          ],
        },
        {
          label: 'Run Bakin',
          items: [
            { label: 'Install', slug: 'run/install' },
            { label: 'First-Time Setup', slug: 'run/first-time-setup' },
            { label: 'Operation', slug: 'run/operation' },
          ],
        },
        {
          label: 'Extend Bakin',
          items: [
            { label: 'Overview', slug: 'extend/overview' },
            { label: 'Plugin Authoring', slug: 'extend/plugins/overview' },
            { label: 'Agent Authoring', slug: 'extend/agents/overview' },
            { label: 'SDK', slug: 'extend/sdk/overview' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Reference Index', slug: 'reference' },
            { label: 'CLI Reference', slug: 'reference/generated/cli' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture/overview' },
          ],
        },
        {
          label: 'Security',
          items: [
            { label: 'Data and Security', slug: 'security/data-and-security' },
          ],
        },
        {
          label: 'Contribute',
          items: [
            { label: 'Overview', slug: 'contribute/overview' },
          ],
        },
      ],
    }),
  ],
})
