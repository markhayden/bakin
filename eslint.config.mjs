import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import noPluginTopLevelSideEffects from "./scripts/eslint-rules/no-plugin-top-level-side-effects.mjs";

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

const adapterBoundaryImportRestrictions = {
  paths: [
    {
      name: "@antfly/sdk",
      message: "Search provider SDK access belongs in packages/adapter-antfly. Use ctx.search/AppServices instead.",
    },
    {
      name: "bun:sqlite",
      message: "Raw SQLite access is not allowed outside adapter/storage ownership boundaries. Use the adapter or Bakin store contract.",
    },
  ],
  patterns: [
    {
      group: [
        "@bakin/adapter-openclaw",
        "@bakin/adapter-openclaw/*",
        "@bakin/adapter-antfly",
        "@bakin/adapter-antfly/*",
        "@bakin/adapter-pi",
        "@bakin/adapter-pi/*",
      ],
      message: "Concrete adapter packages may only be imported by adapter factories. Use @bakin/core adapter interfaces, ctx.runtime, ctx.search, or AppServices.",
    },
    {
      group: [
        "@/core/antfly",
        "@/core/antfly/*",
        "src/core/antfly",
        "src/core/antfly/*",
        "**/core/antfly-server",
        "**/core/openclaw-client",
        "**/core/openclaw-home",
        "**/core/openclaw-config",
        "**/discord-gateway",
      ],
      message: "Legacy provider internals are behind the adapter layer. Route through the runtime/search adapter contract.",
    },
  ],
};

const bakinPluginRules = {
  rules: {
    "no-plugin-top-level-side-effects": noPluginTopLevelSideEffects,
  },
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
    // Disposable dockerized-rig homes (gitignored). They hold a full OpenClaw
    // install + Codex-downloaded third-party plugin sources; linting them is
    // meaningless and breaks local `bun run lint`. CI never has these dirs.
    "dev/openclaw-home/**",
    "dev/bakin-instances/**",
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
  // Adapter boundary: production code talks to runtime/search providers only
  // through AppServices and adapter contracts. Concrete adapter factories are
  // the only non-adapter modules allowed to import adapter packages directly.
  {
    files: [
      "src/**/*.{ts,tsx,js,mjs,mts}",
      "packages/core/src/**/*.{ts,tsx,js,mjs,mts}",
      "packages/host/src/**/*.{ts,tsx,js,mjs,mts}",
      "plugins/**/*.{ts,tsx,js,mjs,mts}",
      "cli/**/*.{ts,tsx,js,mjs,mts}",
      "scripts/**/*.{ts,tsx,js,mjs,mts}",
      "server.ts",
    ],
    ignores: [
      "src/core/runtime-adapter-factory.ts",
      "src/core/search-adapter-factory.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", adapterBoundaryImportRestrictions],
    },
  },
  // The shared storage core is the SOLE bun:sqlite importer (enforced by
  // tests/architecture/adapter-boundary.test.ts). Re-apply the adapter
  // boundary minus the bun:sqlite path for this one file.
  {
    files: ["packages/core/src/storage/db.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: adapterBoundaryImportRestrictions.paths.filter((p) => p.name !== "bun:sqlite"),
        patterns: adapterBoundaryImportRestrictions.patterns,
      }],
    },
  },
  // Plugin isolation: every plugin talks to Bakin's shell and to other
  // plugins exclusively through @makinbakin/sdk/*. Direct imports from another
  // plugin's internals or from Bakin's src/ components/hooks are banned so
  // the SDK surface stays the contract. This is the architectural lock
  // established in #141 (SDK + slot system) and enforced through the Bun
  // migration in #147.
  {
    files: ["plugins/**/*.{ts,tsx,js,mjs,mts}"],
    plugins: { bakin: bakinPluginRules },
    rules: {
      "bakin/no-plugin-top-level-side-effects": "error",
      "no-restricted-imports": ["error", {
        paths: adapterBoundaryImportRestrictions.paths,
        patterns: [
          ...adapterBoundaryImportRestrictions.patterns,
          {
            group: [
              "@bakin/tasks/*",
              "@bakin/team/*",
              "@bakin/workflows/*",
              "@bakin/assets/*",
              "@bakin/schedule/*",
              "@bakin/health/*",
              "@bakin/memory/*",
              "@bakin/models/*",
            ],
            message: "Plugins cannot import from other plugins. Use @makinbakin/sdk/* instead.",
          },
          {
            group: ["@bakin/ui", "@bakin/ui/*"],
            message: "@bakin/ui is private implementation. Plugins must import through @makinbakin/sdk/*.",
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
            message: "Plugins must import via @makinbakin/sdk/{ui,hooks,components,slots,types,utils}.",
          },
        ],
      }],
    },
  },
  // No hard navigation for internal routes (routing overhaul D3): internal
  // links go through PluginLink / TanStack Link / useRouter().push — never a
  // full page load. CI gate + allowlist live in
  // tests/architecture/no-hard-navigation.test.ts; this block mirrors it for
  // in-editor feedback. Keep the two allowlists in sync.
  {
    files: [
      "packages/host/src/**/*.{ts,tsx}",
      "packages/sdk/src/**/*.{ts,tsx}",
      "plugins/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
      "src/context/**/*.{ts,tsx}",
    ],
    ignores: [
      // Server handlers + dev tooling (reloads by design):
      "packages/host/src/api/**",
      "packages/host/src/dev-client/**",
      // Deliberate full reloads, reasons in the arch test:
      "packages/sdk/src/navigation/unsaved-changes-guard.tsx",
      "src/lib/browser-notify.ts",
      "packages/host/src/components/layout/header.tsx",
      "packages/host/src/plugin-host/PluginHost.tsx",
      "packages/sdk/src/navigation/router.ts",
      "src/hooks/use-sse.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "CallExpression[callee.property.name=/^(assign|replace|reload)$/][callee.object.property.name='location']",
          message: "Hard navigation for internal routes is banned — use useRouter().push / PluginLink (see tests/architecture/no-hard-navigation.test.ts).",
        },
        {
          selector: "CallExpression[callee.property.name=/^(assign|replace|reload)$/][callee.object.name='location']",
          message: "Hard navigation for internal routes is banned — use useRouter().push / PluginLink (see tests/architecture/no-hard-navigation.test.ts).",
        },
        {
          selector: "AssignmentExpression[left.property.name='href'][left.object.property.name='location']",
          message: "`location.href =` full-reloads the shell — use useRouter().push / PluginLink.",
        },
        {
          selector: "AssignmentExpression[left.property.name='href'][left.object.name='location']",
          message: "`location.href =` full-reloads the shell — use useRouter().push / PluginLink.",
        },
        {
          selector: "JSXOpeningElement[name.name='a'] JSXAttribute[name.name='href'] Literal[value=/^\\u002F(?!api\\u002F)/]",
          message: "Raw internal <a href=\"/…\"> anchors full-reload the shell — use PluginLink (SDK) or TanStack Link.",
        },
      ],
    },
  },
]);

export default eslintConfig;
