/**
 * Barrel for the read-only CLI report components, split per domain into
 * `./reports/*` (WS4 B1). Preserves the historical `import('.../cli/ui/readonly')`
 * path so every dynamic-import call site and `readonly-ui.test.tsx` keep working.
 * `export *` re-exports the components AND their `*Data` prop types.
 */
export * from './reports/format'
export * from './reports/command-meta'
export * from './reports/runtime'
export * from './reports/settings'
export * from './reports/tasks'
export * from './reports/workflows'
export * from './reports/plugins'
export * from './reports/packages'
export * from './reports/search'
export * from './reports/schedule'
export * from './reports/trash'
