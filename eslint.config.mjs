import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  globalIgnores([
    "node_modules/**",
    "packages/host/dist/**",
    "packages/host/public/vendor/**",
    "plugins/**/dist/**",
    "dist/**",
    "bun-env.d.ts",
  ]),
  // Plugin isolation: every plugin talks to Bakin's shell and to other
  // plugins exclusively through @bakin/sdk/*. Direct imports from another
  // plugin's internals or from Bakin's src/ components/hooks are banned so
  // the SDK surface stays the contract. This is the architectural lock
  // established in #141 (SDK + slot system) and enforced through the Bun
  // migration in #147.
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
  // Phase 7 layering rule (#174). Core code (src/, cli/, packages/core/)
  // MUST NOT import from third-party plugins installed under
  // `~/.bakin/plugins/`. Feature modules under `plugins/<id>/` (the 8
  // built-in plugins) ARE allowed via the `@bakin/{plugin}/*` aliases —
  // those resolve to in-repo paths, not the runtime install dir.
  //
  // The fitness test at `tests/architecture/feature-module-vs-plugin
  // .test.ts` walks the same directories and grep-asserts the same
  // boundary as a belt-and-suspenders check; both must stay in sync.
  {
    files: [
      "src/core/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "cli/**/*.{ts,tsx}",
      "packages/core/**/*.{ts,tsx}",
      "packages/host/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            // Path strings that point at a third-party plugin install
            // location. These never resolve at module-resolution time
            // (~/.bakin/plugins/ isn't on the module path) but a
            // string literal would survive in dynamic imports / require
            // calls — bake the rejection in here so the boundary holds
            // even when an author reaches for `import(...)`.
            group: [
              "**/.bakin/plugins/**",
              "~/.bakin/plugins/**",
            ],
            message: "Core code MUST NOT import from third-party plugins under ~/.bakin/plugins/. Communication runs through ctx.hooks (server) and @bakin/sdk/hooks (client). See .claude/knowledge/plugin-system.md § Feature modules vs third-party plugins.",
          },
        ],
      }],
    },
  },
]);

export default eslintConfig;
