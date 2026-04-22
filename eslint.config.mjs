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
]);

export default eslintConfig;
