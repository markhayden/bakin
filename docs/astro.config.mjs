import { defineConfig, passthroughImageService } from 'astro/config'
import starlight from '@astrojs/starlight'
import react from '@astrojs/react'
import rehypeExternalLinks from 'rehype-external-links'

const gtmId = process.env.PUBLIC_GTM_ID ?? 'GTM-KZQK989V'

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
        ...(gtmId
          ? [
              {
                tag: 'script',
                content: `
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
(function () {
  var COOKIE_NAME = "bakin_consent";
  var SCHEMA_VERSION = 1;
  function readStoredConsent() {
    var match = document.cookie.split("; ").find(function (row) {
      return row.indexOf(COOKIE_NAME + "=") === 0;
    });
    if (!match) return null;
    try {
      var raw = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.v !== SCHEMA_VERSION) return null;
      if (parsed.a !== "g" && parsed.a !== "d") return null;
      if (parsed.d !== "g" && parsed.d !== "d") return null;
      return {
        analytics_storage: parsed.a === "g" ? "granted" : "denied",
        ad_storage: parsed.d === "g" ? "granted" : "denied"
      };
    } catch (e) {
      return null;
    }
  }
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    wait_for_update: 500
  });
  var stored = readStoredConsent();
  if (stored) {
    window.gtag("consent", "update", {
      analytics_storage: stored.analytics_storage,
      ad_storage: stored.ad_storage,
      ad_user_data: stored.ad_storage,
      ad_personalization: stored.ad_storage
    });
    window.dataLayer.push({
      event: "consent_update",
      analytics_storage: stored.analytics_storage,
      ad_storage: stored.ad_storage,
      source: "restore"
    });
  } else {
    window.dataLayer.push({
      event: "consent_update",
      analytics_storage: "granted",
      ad_storage: "granted",
      source: "default"
    });
  }
})();
`,
            },
            {
              tag: 'script',
              attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtm.js?id=${gtmId}`,
              },
            },
            {
              tag: 'script',
              content: `
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: "gtm_boot",
  page_path: window.location.pathname,
  page_title: document.title
});
window.dataLayer.push({
  event: "page_view_custom",
  page_path: window.location.pathname,
  page_title: document.title,
  page_location: window.location.href
});
document.addEventListener("click", function (event) {
  var target = event.target instanceof Element ? event.target.closest("[data-cta], a[href]") : null;
  if (!target) return;
  var cta = target.getAttribute("data-cta");
  var href = target instanceof HTMLAnchorElement ? target.href : target.getAttribute("href");
  var label = target.textContent ? target.textContent.trim() : "";
  var outbound = href ? /^https?:\\/\\//.test(href) && href.indexOf(window.location.host) === -1 : false;
  if (cta) {
    window.dataLayer.push({
      event: "cta_click",
      cta_name: cta,
      cta_label: label,
      page_path: window.location.pathname
    });
  }
  if (outbound) {
    window.dataLayer.push({
      event: "outbound_click",
      outbound_url: href,
      link_label: label,
      page_path: window.location.pathname
    });
  }
});
`,
              },
            ]
          : []),
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
            { label: 'Schedule', slug: 'using/schedule' },
            { label: 'Messaging', slug: 'using/messaging' },
            { label: 'Projects', slug: 'using/projects' },
            { label: 'Workflows', slug: 'using/workflows' },
            { label: 'Memory', slug: 'using/memory' },
            { label: 'Team', slug: 'using/team' },
            { label: 'Models', slug: 'using/models' },
            { label: 'Git', slug: 'using/git' },
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
