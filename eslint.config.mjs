import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Bakin runs across Bun server code, browser UI code, CLI scripts, and tests.
// TypeScript owns undefined checks; this keeps ESLint from misclassifying
// shared runtime globals as undefined in mixed execution contexts.
const bunGlobals = {
  Bun: "readonly",
  console: "readonly",
  crypto: "readonly",
  CustomEvent: "readonly",
  Event: "readonly",
  EventTarget: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  localStorage: "readonly",
  MessageChannel: "readonly",
  MessageEvent: "readonly",
  navigator: "readonly",
  process: "readonly",
  Request: "readonly",
  Response: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  window: "readonly",
  document: "readonly",
  WebSocket: "readonly",
};

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: bunGlobals,
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "off",
      "no-control-regex": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // The plugin and CLI surfaces intentionally use dynamic values and
      // lazy require() in a few places; typecheck/tests are the enforcement
      // layer for those contracts.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
    },
  },
  globalIgnores([
    "node_modules/**",
    "coverage/**",
    "packages/*/.turbo/**",
    "packages/*/dist/**",
    "packages/host/dist/**",
    "packages/host/src/api/_embedded-assets-static.ts",
    "packages/host/public/**",
    "packages/host/public/vendor/**",
    "plugins/**/dist/**",
    "dist/**",
    "bun-env.d.ts",
  ]),
  {
    files: [
      "tests/**/*.{ts,tsx,js,mjs,cjs}",
      "**/*.test.{ts,tsx,js,mjs,cjs}",
      "dev/**/*.{ts,tsx,js,mjs,cjs}",
    ],
    rules: {
      "no-empty": "off",
      "no-unassigned-vars": "off",
      "@typescript-eslint/no-unassigned-vars": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
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
