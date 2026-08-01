import { defineConfig, passthroughImageService } from 'astro/config'
import starlight from '@astrojs/starlight'
import react from '@astrojs/react'
import rehypeExternalLinks from 'rehype-external-links'

export default defineConfig({
  site: 'https://makinbakin.com',
  base: '/docs',
  image: {
    service: passthroughImageService(),
  },
  markdown: {
    rehypePlugins: [
      [
        rehypeExternalLinks,
        {
          target: '_blank',
          rel: ['noopener', 'noreferrer'],
        },
      ],
    ],
  },
  integrations: [
    react(),
    starlight({
      title: 'Bakin Docs',
      logo: {
        src: './src/assets/bakin-logo.svg',
        alt: 'Bakin',
      },
      customCss: ['./src/styles/docs.css'],
      components: {
        Head: './src/components/Head.astro',
        SkipLink: './src/components/SkipLink.astro',
        Header: './src/components/Header.astro',
        PageTitle: './src/components/PageTitle.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        Footer: './src/components/DocsFooter.astro',
      },
      head: [
        {
          tag: 'script',
          content: `
// Pin the TOC link that matches the URL hash. Starlight's scroll-spy uses
// IntersectionObserver to highlight the TOC entry for the heading currently
// in view, but sections at the very bottom of a page can't scroll high enough
// to trigger the observer — so clicking them sets the URL hash without any
// visible TOC feedback. Re-applying on hashchange + page-load fixes that.
(function () {
  var ATTR = 'data-toc-hash-pinned';
  function escapeHash(hash) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(hash);
    return hash.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }
  function apply() {
    document.querySelectorAll('[' + ATTR + ']').forEach(function (el) {
      el.removeAttribute(ATTR);
    });
    var hash = window.location.hash.slice(1);
    if (!hash) return;
    var link = document.querySelector('starlight-toc a[href$="#' + escapeHash(hash) + '"]');
    if (link) link.setAttribute(ATTR, '');
  }
  window.addEventListener('hashchange', apply);
  document.addEventListener('astro:page-load', apply);
  if (document.readyState !== 'loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);
})();
          `,
        },
      ],
      defaultLocale: 'root',
      editLink: {
        baseUrl: 'https://github.com/markhayden/bakin/edit/main/docs/',
      },
      lastUpdated: true,
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/markhayden/bakin',
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
            { label: 'Install', slug: 'start/install' },
            { label: 'Initial Setup', slug: 'start/first-time-setup' },
            { label: 'Daily Operation', slug: 'start/operation' },
          ],
        },
        {
          label: 'Using',
          items: [
            { label: 'Essentials', slug: 'using/essentials' },
            { label: 'Tasks', slug: 'using/tasks' },
            { label: 'Assets', slug: 'using/assets' },
            { label: 'Images', slug: 'using/images' },
            { label: 'Brands', slug: 'using/brands' },
            { label: 'Schedule', slug: 'using/schedule' },
            { label: 'Messaging', slug: 'using/messaging' },
            { label: 'Projects', slug: 'using/projects' },
            { label: 'Workflows', slug: 'using/workflows' },
            { label: 'Memory', slug: 'using/memory' },
            { label: 'Team', slug: 'using/team' },
            { label: 'Hub Skills', slug: 'using/skills' },
            { label: 'Models', slug: 'using/models' },
            { label: 'Development', slug: 'using/git' },
            { label: 'Health', slug: 'using/health' },
            { label: 'Settings', slug: 'using/settings' },
          ],
        },
        {
          label: 'Extending',
          items: [
            { label: 'Overview', slug: 'extending/overview' },
            { label: 'Ingredients', slug: 'extending/ingredients' },
            {
              label: 'Plugins',
              items: [
                { label: 'Overview', slug: 'extending/plugins/overview' },
                { label: 'Build a Plugin', slug: 'extending/plugins/build' },
                { label: 'Manifest', slug: 'extending/plugins/manifest' },
                { label: 'Client UI', slug: 'extending/plugins/client-ui' },
                { label: 'Server Contracts', slug: 'extending/plugins/server-contracts' },
                { label: 'Realtime Events', slug: 'extending/plugins/realtime' },
                { label: 'Search', slug: 'extending/plugins/search' },
                { label: 'Distribute', slug: 'extending/plugins/distribute' },
              ],
            },
            {
              label: 'Agent Kits',
              items: [
                { label: 'Overview', slug: 'extending/agents/overview' },
                { label: 'Package Manifest', slug: 'extending/agents/packages' },
                { label: 'Lesson Blocks', slug: 'extending/agents/lessons' },
              ],
            },
            { label: 'SDK', slug: 'extending/sdk/overview' },
            { label: 'UI Style Guide', slug: 'extending/ui/overview' },
            { label: 'Architecture', slug: 'extending/architecture' },
            { label: "Bakin' Core", slug: 'extending/development-workflow' },
            { label: 'Quality Control', slug: 'extending/quality-control' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/generated/cli' },
            { label: 'API Reference', slug: 'reference/generated/api' },
            { label: 'Hooks', slug: 'reference/generated/hooks' },
            { label: 'MCP', slug: 'reference/generated/exec-tools' },
            { label: 'Official Plugins', slug: 'reference/generated/core-plugins' },
            { label: 'Defaults', slug: 'reference/generated/settings' },
            { label: 'Runtime Paths', slug: 'reference/generated/runtime-paths' },
            { label: 'SDK Reference', slug: 'reference/generated/sdk' },
            { label: 'UI Tokens', slug: 'reference/generated/ui-tokens' },
          ],
        },
        {
          label: 'Security',
          items: [
            { label: 'Data and Security', slug: 'security/data-and-security' },
          ],
        },
      ],
    }),
  ],
})
