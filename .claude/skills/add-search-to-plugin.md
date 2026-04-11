# Add Search to a Plugin

## When to Use

When a new or existing Bakin plugin needs Antfly search integration.

## Prerequisites

- Plugin has a `bakin-plugin.json` manifest and `index.ts` with `activate(ctx)`
- `ctx.search` is available on `PluginContext` (added in T1.2)

## Steps

### 1. Identify the data model

Read the plugin's types and data access layer. Answer:
- What fields should be searchable (text)?
- What fields should be filterable (keyword)?
- What is the data source (filesystem, SQLite, OpenClaw)?
- Are any fields very long (need chunking)?

### 2. Add registerContentType at top of activate()

```typescript
activate(ctx: PluginContext) {
  ctx.search.registerContentType({
    table: '{pluginId}',
    schema: { /* fields */ },
    searchableFields: [/* text fields for BM25 */],
    embeddingTemplate: '{{field1}} {{field2}}',
    facets: [/* keyword fields for filtering */],
    reindex: async function* () { /* yield {key, doc} for all items */ },
    verifyExists: async (key) => { /* check source existence */ },
  })
```

### 3. Add helper functions

Create `itemToSearchDoc()` and `indexItem()` inside `activate()`:

```typescript
function itemToSearchDoc(item: MyType): Record<string, unknown> {
  return { /* map item fields to schema fields */ }
}

async function indexItem(id: string): Promise<void> {
  const item = loadItem(id)
  if (item) await ctx.search.index(id, itemToSearchDoc(item))
}
```

### 4. Wire indexing into all mutation paths

Find every place the plugin creates, updates, or deletes data. Add:
- `indexItem(id).catch(() => {})` after create/update
- `ctx.search.remove(id).catch(() => {})` after delete
- `ctx.search.transform(id, ops).catch(() => {})` for metadata-only updates

Check both REST route handlers AND MCP exec tool handlers.

### 5. Verify

```bash
pnpm tsc --noEmit    # type check
pnpm test -- --run   # full test suite
```

### 6. Test manually

1. Start Bakin with Antfly enabled
2. Create an item through the UI or API
3. Check `GET /api/search?q=<term>&table={pluginId}` returns the item
4. Delete the item and verify search no longer returns it

## Reference

- Full guide: `.claude/knowledge/search-plugin-guide.md`
- Architecture: `.claude/knowledge/search-system.md`
- Type definitions: `packages/core/src/plugin-types.ts` (SearchAPI, SearchContentTypeDefinition)
- Registry implementation: `src/core/search-registry.ts`
- Example (tasks): `plugins/tasks/index.ts` lines 58-115
