# Create Plugin

Scaffold a new Bakin plugin with all required files following the established patterns.

## Steps

1. Ask for: plugin id (kebab-case), display name, description, dependencies (other plugin ids), required secrets (vault keys)

2. Create `plugins/{id}/bakin-plugin.json`:
```json
{
  "id": "{id}",
  "name": "{name}",
  "version": "1.0.0",
  "bakin": ">=1.0.0",
  "description": "{description}",
  "entry": { "server": "index.ts" },
  "contentFiles": [],
  "secrets": ["{required-vault-keys}"],
  "tests": "tests/",
  "dependencies": ["{dependencies}"],
  "permissions": ["storage.read", "storage.write", "events.emit"]
}
```

3. Create `plugins/{id}/index.ts`:
```typescript
import type { BakinPlugin, PluginContext } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'

const log = createLogger('{id}')

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const plugin: BakinPlugin = {
  id: '{id}',
  name: '{name}',
  version: '1.0.0',

  navItems: [
    { id: '{id}', label: '{name}', icon: '{icon}', href: '/{id}', order: 50 },
  ],

  // Settings schema — auto-renders into a plugin config screen
  settingsSchema: {
    // example: featureToggle: { type: 'boolean', default: true, label: 'Enable feature', description: '...' },
  },

  async activate(ctx: PluginContext) {
    ctx.registerNav(this.navItems!)

    ctx.registerRoute({
      path: '/list',
      method: 'GET',
      handler: async () => json({ items: [] }),
      description: 'List all {name} items',
    })

    log.info('{name} plugin activated')
  },
}

export default plugin
```

4. Create `plugins/{id}/client.tsx`:
```typescript
import type { NavItem } from '../../src/lib/plugin-types'

export const navItems: NavItem[] = [
  { id: '{id}', label: '{name}', icon: '{icon}', href: '/{id}', order: 50 },
]
```

5. Create `plugins/{id}/types.ts` with placeholder types

6. Create `plugins/{id}/components/` directory

7. Create `src/app/{id}/page.tsx` with a basic page component

8. Add the plugin to `bakin.config.ts`:
```typescript
{ path: 'plugins/{id}' },
```

9. Add tsconfig path alias:
```json
"@bakin/{id}": ["./plugins/{id}"],
"@bakin/{id}/*": ["./plugins/{id}/*"]
```

10. Add client import to `src/lib/plugin-manifest.ts`

## Plugin Configuration Pattern

Plugins have three tiers of configuration:

### Settings (non-sensitive, schema-driven)
Declared via `settingsSchema` on the plugin object. Each key defines a setting with type, default, label, and description. Supported types: `boolean`, `string`, `number`, `select` (with options array).

```typescript
settingsSchema: {
  thumbnails: { type: 'boolean', default: true, label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload' },
  maxFileSize: { type: 'number', default: 50, label: 'Max file size (MB)', description: 'Reject uploads larger than this' },
  defaultFormat: { type: 'select', default: 'webp', options: ['webp', 'png', 'jpg'], label: 'Default image format' },
}
```

A generic `<PluginSettings pluginId="{id}" />` component auto-renders the schema into a form (toggles for booleans, number inputs, dropdowns for selects, text inputs for strings) with dirty state tracking, save/cancel, and validation. Plugins never build custom settings UIs unless they need something exotic.

Stored in `~/.bakin/plugin-settings/{id}.json`. Accessed via `ctx.getSettings()` / `ctx.updateSettings()`.

### Secrets (sensitive)
Declared in manifest `secrets` array. Pulled from vault at runtime, never persisted in plugin settings.
Vault resolution: OpenClaw config (`~/.openclaw/openclaw.json` skill entries) → env vars → `~/.bakin/secrets.json`.
Accessed via scoped `ctx.vault.get("key")` — plugin can only read keys declared in its manifest.
`createPluginVault()` in `src/core/vault.ts` already implements scoped access.

### Dependencies
Manifest `dependencies` array lists required plugins. `secrets` array lists required vault keys.
`bakin doctor` validates all requirements are met.

## Checklist
- [ ] bakin-plugin.json exists with valid schema
- [ ] index.ts exports BakinPlugin with activate() and settingsSchema
- [ ] client.tsx exports navItems
- [ ] Page route exists in src/app/
- [ ] Plugin added to bakin.config.ts
- [ ] tsconfig paths updated
- [ ] Plugin manifest updated
- [ ] Secrets declared if needed, vault keys documented
- [ ] `npm run dev` starts without errors
