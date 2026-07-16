# Create Plugin

Scaffold a new Bakin plugin with all required files following the established patterns.

## Steps

1. Ask for: plugin id (kebab-case), display name, description, dependencies (other plugin ids), required secrets (canonical env var names), and—if it has a page—its Lucide icon and navigation section (`plan-and-automate`, `create`, `operations`, or omitted for Mix-ins).

2. Create `plugins/{id}/bakin-plugin.json`:
```json
{
  "id": "{id}",
  "name": "{name}",
  "version": "1.0.0",
  "bakin": ">=1.0.0",
  "description": "{description}",
  "contentFiles": [],
  "secrets": [
    {
      "name": "{ENV_VAR_NAME}",
      "description": "{what this secret is used for}",
      "required": true
    }
  ],
  "dependencies": ["{dependencies}"],
  "permissions": ["storage.read", "storage.write", "events.emit"],
  "contributes": {
    "nav": [
      {
        "id": "{id}",
        "label": "{name}",
        "icon": "{icon}",
        "href": "/{id}",
        "order": 100,
        "section": "{section}"
      }
    ],
    "routes": [
      { "path": "/{id}" }
    ],
    "clientRoutes": [
      { "path": "/{id}", "summary": "{name} page" }
    ]
  }
}
```

Omit the `section` property entirely when the plugin should appear under Mix-ins. Never invent a section name or use placement/expansion fields.

3. Create `plugins/{id}/index.ts`:
```typescript
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
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

  // Settings schema — auto-renders into a plugin config screen
  settingsSchema: {
    // example: featureToggle: { type: 'boolean', default: true, label: 'Enable feature', description: '...' },
  },

  async activate(ctx: PluginContext) {
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

4. Create `plugins/{id}/client.tsx` with a runtime declaration matching the manifest exactly:
```tsx
import { registerPlugin, type NavItem } from '@makinbakin/sdk'

function PluginPage() {
  return <div>{name}</div>
}

const navItems: NavItem[] = [
  { id: '{id}', label: '{name}', icon: '{icon}', href: '/{id}', order: 100, section: '{section}' },
]

registerPlugin({
  id: '{id}',
  navItems,
  routes: { '/{id}': PluginPage },
})
```

As in the manifest, omit `section` from the runtime object for Mix-ins.

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
Declared in manifest `secrets` array as metadata objects keyed by canonical env var name. Secret values are never persisted in plugin settings, manifests, or lockfiles.
Bakin declares and checks required secret names; the runtime adapter or local environment owns value storage and lookup.

### Dependencies
Manifest `dependencies` array lists required plugins. `secrets` array lists required runtime secret declarations.
`bakin doctor` validates all requirements are met.

## Checklist
- [ ] bakin-plugin.json exists with valid schema
- [ ] index.ts exports BakinPlugin with activate() and settingsSchema
- [ ] client.tsx exports navItems
- [ ] Page route exists in src/app/
- [ ] Plugin added to bakin.config.ts
- [ ] tsconfig paths updated
- [ ] Plugin manifest updated
- [ ] Secrets declared if needed, env var names documented
- [ ] `npm run dev` starts without errors
