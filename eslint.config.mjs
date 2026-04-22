import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Plugin isolation: every plugin talks to Bakin's shell and to other
  // plugins exclusively through @bakin/sdk/*. Direct imports from another
  // plugin's internals or from Bakin's src/ components/hooks are banned so
  // the SDK surface stays the contract. This is the architectural lock for
  // issue #141's client-side plugin loader — see the spec at
  // .claude/specs/plugin-client-ui-loader.md.
  {
    files: ["plugins/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: [
              "@bakin/tasks/*",
              "@bakin/team/*",
              "@bakin/workflows/*",
              "@bakin/assets/*",
              "@bakin/projects/*",
              "@bakin/schedule/*",
              "@bakin/health/*",
              "@bakin/memory/*",
              "@bakin/messaging/*",
              "@bakin/models/*",
            ],
            message: "Plugins cannot import from other plugins. Use @bakin/sdk/* instead.",
          },
          {
            group: [
              "@/components/ui/*",
              "@/components/agent-*",
              "@/components/bakin-drawer",
              "@/components/color-picker",
              "@/components/empty-state",
              "@/components/error-banner",
              "@/components/error-state",
              "@/components/facet-filter",
              "@/components/markdown-*",
              "@/components/model-select",
              "@/components/page-layout",
              "@/components/plugin-header",
              "@/components/plugin-settings-renderer",
              "@/components/sortable-head",
              "@/components/underline-tabs",
              "@/hooks/*",
              "@/types",
              "@/lib/utils",
              "@/lib/format",
              "../../src/components/**",
              "../../src/hooks/**",
              "../../src/types",
            ],
            message: "Plugins must import via @bakin/sdk/{ui,hooks,components,slots,types,utils}.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
