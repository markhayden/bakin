import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { WorkflowDefinition } from '@bakin/workflows/types'

// Defensive mocks per CLAUDE.md test isolation rules — this test is pure
// in-memory registry logic but we stub storage modules so the registry can
// never accidentally read from or write to ~/.bakin/ or ~/.openclaw/.
const testDir = join(tmpdir(), `bakin-test-source-registry-${Date.now()}`)
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/tasks/lib/flow-store', () => ({}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import {
  registerPluginDefinition,
  registerAgentPackageDefinition,
  registerUserDefinition,
  unregisterPluginDefinitions,
  unregisterAgentPackageDefinitions,
  unregisterUserDefinition,
  getDefinition,
  listAll,
  isReadOnly,
  getSource,
  clearSourceRegistry,
} from '@bakin/workflows/lib/source-registry'

function def(name: string, extras: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name,
    description: `${name} desc`,
    version: 1,
    steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }],
    ...extras,
  }
}

describe('source-registry', () => {
  beforeEach(() => {
    clearSourceRegistry()
  })

  describe('plugin registration', () => {
    it('registers a plugin-owned definition and exposes it via getDefinition', () => {
      registerPluginDefinition('workflows', 'video-script', def('Video Script'))
      const entry = getDefinition('video-script')
      expect(entry).toBeDefined()
      expect(entry!.source).toBe('plugin')
      expect(entry!.pluginId).toBe('workflows')
      expect(entry!.definition.name).toBe('Video Script')
    })

    it('throws when two different plugins register the same id', () => {
      registerPluginDefinition('workflows', 'shared-id', def('First'))
      expect(() =>
        registerPluginDefinition('sdr', 'shared-id', def('Second'))
      ).toThrow(/already registered/)
    })

    it('lets the same plugin overwrite its own registration (hot reload)', () => {
      registerPluginDefinition('workflows', 'x', def('Old'))
      expect(() => registerPluginDefinition('workflows', 'x', def('New'))).not.toThrow()
      expect(getDefinition('x')!.definition.name).toBe('New')
    })

    it('unregisterPluginDefinitions removes all ids owned by that plugin', () => {
      registerPluginDefinition('workflows', 'a', def('A'))
      registerPluginDefinition('workflows', 'b', def('B'))
      registerPluginDefinition('sdr', 'c', def('C'))

      unregisterPluginDefinitions('workflows')

      expect(getDefinition('a')).toBeUndefined()
      expect(getDefinition('b')).toBeUndefined()
      expect(getDefinition('c')!.pluginId).toBe('sdr')
    })
  })

  describe('user registration', () => {
    it('registers a user definition with source="user"', () => {
      registerUserDefinition('my-wf', def('Mine'))
      const entry = getDefinition('my-wf')
      expect(entry!.source).toBe('user')
      expect(entry!.pluginId).toBeUndefined()
    })

    it('user definition shadows a plugin registration with the same id (user wins)', () => {
      registerPluginDefinition('workflows', 'video-script', def('Original'))
      registerUserDefinition('video-script', def('Custom Override'))

      const entry = getDefinition('video-script')
      expect(entry!.source).toBe('user')
      expect(entry!.definition.name).toBe('Custom Override')
    })

    it('user shadow does NOT trigger the plugin-collision throw', () => {
      registerPluginDefinition('workflows', 'video-script', def('Original'))
      expect(() => registerUserDefinition('video-script', def('Override'))).not.toThrow()
    })

    it('unregisterUserDefinition falls back to the plugin shadow when present', () => {
      registerPluginDefinition('workflows', 'video-script', def('Original'))
      registerUserDefinition('video-script', def('Override'))

      unregisterUserDefinition('video-script')

      const entry = getDefinition('video-script')
      expect(entry!.source).toBe('plugin')
      expect(entry!.definition.name).toBe('Original')
    })

    it('unregisterUserDefinition with no plugin shadow removes the id entirely', () => {
      registerUserDefinition('solo', def('Solo'))
      unregisterUserDefinition('solo')
      expect(getDefinition('solo')).toBeUndefined()
    })
  })

  describe('agent-package registration', () => {
    it('registers an agent-package-owned definition with source="agent-package"', () => {
      registerAgentPackageDefinition('pixel', 'image-generation', def('Image Generation'))
      const entry = getDefinition('image-generation')
      expect(entry).toBeDefined()
      expect(entry!.source).toBe('agent-package')
      expect(entry!.packageId).toBe('pixel')
      expect(entry!.pluginId).toBeUndefined()
    })

    it('throws when two different agent-packages register the same id', () => {
      registerAgentPackageDefinition('pixel', 'shared', def('Pixel'))
      expect(() =>
        registerAgentPackageDefinition('rolo', 'shared', def('Rolo')),
      ).toThrow(/already registered/)
    })

    it('lets the same package overwrite its own registration (update)', () => {
      registerAgentPackageDefinition('pixel', 'gen', def('Old'))
      expect(() => registerAgentPackageDefinition('pixel', 'gen', def('New'))).not.toThrow()
      expect(getDefinition('gen')!.definition.name).toBe('New')
    })

    it('unregisterAgentPackageDefinitions removes all ids for that package', () => {
      registerAgentPackageDefinition('pixel', 'a', def('A'))
      registerAgentPackageDefinition('pixel', 'b', def('B'))
      registerAgentPackageDefinition('rolo', 'c', def('C'))

      unregisterAgentPackageDefinitions('pixel')

      expect(getDefinition('a')).toBeUndefined()
      expect(getDefinition('b')).toBeUndefined()
      expect(getDefinition('c')!.packageId).toBe('rolo')
    })

    it('agent-package shadows a plugin registration with the same id', () => {
      registerPluginDefinition('workflows', 'image-gen', def('Plugin Default'))
      registerAgentPackageDefinition('pixel', 'image-gen', def('Pixel Override'))

      const entry = getDefinition('image-gen')
      expect(entry!.source).toBe('agent-package')
      expect(entry!.definition.name).toBe('Pixel Override')
    })

    it('user shadows agent-package (user > agent-package > plugin)', () => {
      registerPluginDefinition('workflows', 'wf', def('Plugin'))
      registerAgentPackageDefinition('pixel', 'wf', def('Package'))
      registerUserDefinition('wf', def('User'))

      const entry = getDefinition('wf')
      expect(entry!.source).toBe('user')
      expect(entry!.definition.name).toBe('User')
    })

    it('unregistering the agent-package falls back through the precedence chain', () => {
      registerPluginDefinition('workflows', 'wf', def('Plugin'))
      registerAgentPackageDefinition('pixel', 'wf', def('Package'))

      // Agent-package wins initially
      expect(getDefinition('wf')!.source).toBe('agent-package')

      // Remove the agent-package — falls back to plugin
      unregisterAgentPackageDefinitions('pixel')
      expect(getDefinition('wf')!.source).toBe('plugin')
    })
  })

  describe('listAll', () => {
    it('returns plugin and user entries, with user-wins where both exist', () => {
      registerPluginDefinition('workflows', 'alpha', def('Plugin Alpha'))
      registerPluginDefinition('workflows', 'beta', def('Plugin Beta'))
      registerUserDefinition('beta', def('User Beta'))
      registerUserDefinition('gamma', def('User Gamma'))

      const all = listAll()
      const byId = new Map(all.map(e => [e.id, e]))

      expect(byId.get('alpha')!.source).toBe('plugin')
      expect(byId.get('beta')!.source).toBe('user')
      expect(byId.get('beta')!.definition.name).toBe('User Beta')
      expect(byId.get('gamma')!.source).toBe('user')
      expect(all.length).toBe(3)
    })

    it('listAll includes agent-package entries with correct source resolution', () => {
      registerPluginDefinition('workflows', 'plugin-only', def('Plugin Only'))
      registerAgentPackageDefinition('pixel', 'pkg-only', def('Pkg Only'))
      registerAgentPackageDefinition('pixel', 'pkg-shadows-plugin', def('Pkg Shadow'))
      registerPluginDefinition('workflows', 'pkg-shadows-plugin', def('Plugin Shadowed'))
      registerUserDefinition('user-wins', def('User Wins'))
      registerAgentPackageDefinition('rolo', 'user-wins', def('Pkg Loses'))

      const byId = new Map(listAll().map((e) => [e.id, e]))

      expect(byId.get('plugin-only')!.source).toBe('plugin')
      expect(byId.get('pkg-only')!.source).toBe('agent-package')
      expect(byId.get('pkg-only')!.packageId).toBe('pixel')
      expect(byId.get('pkg-shadows-plugin')!.source).toBe('agent-package')
      expect(byId.get('user-wins')!.source).toBe('user')
    })

    it('returns an empty list when nothing is registered', () => {
      expect(listAll()).toEqual([])
    })
  })

  describe('isReadOnly / getSource helpers', () => {
    it('isReadOnly is true for plugin-only ids, false when shadowed by user', () => {
      registerPluginDefinition('workflows', 'locked', def('Locked'))
      registerPluginDefinition('workflows', 'shadowed', def('Plugin'))
      registerUserDefinition('shadowed', def('User'))
      registerUserDefinition('user-only', def('User Only'))

      expect(isReadOnly('locked')).toBe(true)
      expect(isReadOnly('shadowed')).toBe(false)
      expect(isReadOnly('user-only')).toBe(false)
      expect(isReadOnly('missing')).toBe(false)
    })

    it('isReadOnly is true for agent-package-owned ids without user shadow', () => {
      registerAgentPackageDefinition('pixel', 'pkg-locked', def('Pkg Locked'))
      registerAgentPackageDefinition('pixel', 'pkg-shadowed', def('Pkg'))
      registerUserDefinition('pkg-shadowed', def('User'))

      expect(isReadOnly('pkg-locked')).toBe(true)
      expect(isReadOnly('pkg-shadowed')).toBe(false)
    })

    it('getSource mirrors getDefinition().source for all three tiers', () => {
      registerPluginDefinition('workflows', 'pl', def('Pl'))
      registerAgentPackageDefinition('pixel', 'pk', def('Pk'))
      registerUserDefinition('us', def('Us'))

      expect(getSource('pl')).toBe('plugin')
      expect(getSource('pk')).toBe('agent-package')
      expect(getSource('us')).toBe('user')
      expect(getSource('missing')).toBeUndefined()
    })
  })

  describe('globalThis persistence', () => {
    it('uses globalThis.__bakinWorkflowSources so state survives module re-evaluation', () => {
      registerPluginDefinition('workflows', 'persisted', def('Persisted'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (globalThis as any).__bakinWorkflowSources
      expect(store).toBeDefined()
      expect(store.plugin.has('persisted')).toBe(true)
    })
  })
})
