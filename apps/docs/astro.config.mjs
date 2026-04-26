import { defineConfig, passthroughImageService } from 'astro/config'
import starlight from '@astrojs/starlight'

const gtmId = process.env.PUBLIC_GTM_ID ?? 'GTM-KZQK989V'

export default defineConfig({
  site: 'https://makinbakin.com',
  base: '/docs',
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
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        PageTitle: './src/components/PageTitle.astro',
        Footer: './src/components/DocsFooter.astro',
      },
      head: gtmId
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
        : [],
      defaultLocale: 'root',
      editLink: {
        baseUrl: 'https://github.com/markhayden/bakin/edit/main/apps/docs/',
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
          label: 'Core',
          items: [
            { label: 'Tasks', slug: 'core/tasks' },
            { label: 'Workflows', slug: 'core/workflows' },
            { label: 'Projects', slug: 'core/projects' },
            { label: 'Assets', slug: 'core/assets' },
            { label: 'Schedule', slug: 'core/schedule' },
            { label: 'Messaging', slug: 'core/messaging' },
            { label: 'Memory', slug: 'core/memory' },
            { label: 'Models', slug: 'core/models' },
            { label: 'Team', slug: 'core/team' },
            { label: 'Health', slug: 'core/health' },
          ],
        },
        {
          label: 'Extend Bakin',
          items: [
            { label: 'Overview', slug: 'extend/overview' },
            { label: 'Plugin Authoring', slug: 'extend/plugins/overview' },
            { label: 'Plugin Manifest', slug: 'extend/plugins/manifest' },
            { label: 'Server Contracts', slug: 'extend/plugins/server-contracts' },
            { label: 'Client UI', slug: 'extend/plugins/client-ui' },
            { label: 'Agent Authoring', slug: 'extend/agents/overview' },
            { label: 'Agent Packages', slug: 'extend/agents/packages' },
            { label: 'Agent Knowledge', slug: 'extend/agents/knowledge' },
            { label: 'SDK', slug: 'extend/sdk/overview' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Reference Index', slug: 'reference' },
            { label: 'CLI Reference', slug: 'reference/generated/cli' },
            { label: 'API Reference', slug: 'reference/generated/api' },
            { label: 'Hook Reference', slug: 'reference/generated/hooks' },
            { label: 'Exec/MCP Tools', slug: 'reference/generated/exec-tools' },
            { label: 'Core Plugins', slug: 'reference/generated/core-plugins' },
            { label: 'Settings', slug: 'reference/generated/settings' },
            { label: 'Runtime Paths', slug: 'reference/generated/runtime-paths' },
            { label: 'SDK Reference', slug: 'reference/generated/sdk' },
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
