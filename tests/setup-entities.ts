/**
 * Test preload: seed the entity registries with what the core plugins
 * declare.
 *
 * In the app the server registry is filled as plugins activate and the
 * browser registry from `/api/plugins/manifest`. A test renders one component
 * or activates one plugin, so without this every `entityHref` would resolve
 * to `null` and links would silently vanish from the code under test. The
 * two registry modules are dependency-free, so importing them here loads
 * nothing a test might want to mock. A test that needs different kinds
 * replaces them (`setEntityDeclarations`, `getEntityRegistry().publish`).
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getEntityRegistry } from '../packages/core/src/plugins/entity-registry'
import { setEntityDeclarations, type EntityDeclaration } from '../packages/sdk/src/navigation/entities'

const pluginsDir = join(import.meta.dir, '../plugins')
const declarations: EntityDeclaration[] = []
for (const pluginId of readdirSync(pluginsDir)) {
  const manifestPath = join(pluginsDir, pluginId, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    id: string
    contributes?: { entities?: Array<Omit<EntityDeclaration, 'pluginId' | 'id'>> }
  }
  const entities = manifest.contributes?.entities ?? []
  getEntityRegistry().publish(manifest.id, entities)
  for (const entity of entities) declarations.push({ ...entity, pluginId: manifest.id, id: `${manifest.id}:${entity.kind}` })
}
setEntityDeclarations(declarations)
