/**
 * Raw recovery routes (self-healing PR1, Codex r1 #7): the recover editor's
 * read/write of a definition FILE and a workflow skill FILE — bytes back
 * whatever state they are in, a save refused with the line or the key, a
 * good save written verbatim.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-wf-raw-routes-${Date.now()}-${randomUUID()}`)
const defsDir = join(testDir, 'workflows', 'definitions')
const skillsDir = join(testDir, 'workflows', 'skills')

mock.module('@bakin/core/main-agent', () => ({ getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main' }))
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ workflows: join(testDir, 'workflows'), db: join(testDir, 'bakin.db') }), resetContentDir: mock(), initBakinHome: mock(), isUsingBakinHome: () => false })
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@/core/task-store', () => ({}))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))

import workflowsPlugin from '@bakin/workflows'
import { clearSourceRegistry, registerPluginDefinition } from '@bakin/core/workflows/source-registry'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import type { WorkflowDefinition } from '@bakin/workflows/types'

const good = 'name: Edit me\ndescription: d\nversion: 1\nsteps:\n  - id: s1\n    type: agent\n    label: Do\n    agent: chef\n'
let activated: ActivatedPlugin

beforeEach(async () => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(defsDir, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  clearSourceRegistry()
  activated = await activatePlugin(workflowsPlugin, testDir)
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const call = (method: string, pattern: string, path: string, opts: Record<string, unknown> = {}) =>
  callRoute(findRoute(activated.routes, method, pattern)!, activated.ctx, { path, ...opts })

describe('GET/PUT /definitions/:name/raw', () => {
  it('reads a user file verbatim, naming the parse error when it has one; a managed definition is dumped and flagged shadowsOnSave', async () => {
    writeFileSync(join(defsDir, 'torn.yaml'), 'name: torn\nsteps:\n  - id: s1\n    label: [unclosed\n')
    const torn = await call('GET', '/definitions/:name/raw', '/definitions/torn/raw', { searchParams: { name: 'torn' } })
    expect(torn.status).toBe(200)
    expect(torn.body).toMatchObject({ id: 'torn', source: 'user', yaml: expect.stringContaining('[unclosed'), parseError: { line: expect.any(Number) } })

    registerPluginDefinition('reports', 'shipped', { name: 'Shipped', description: 'd', version: 1, steps: [{ id: 's1', type: 'agent', label: 'Do', agent: 'chef' }] } as unknown as WorkflowDefinition)
    const shipped = await call('GET', '/definitions/:name/raw', '/definitions/shipped/raw', { searchParams: { name: 'shipped' } })
    expect(shipped.body).toMatchObject({ id: 'shipped', source: 'plugin', path: null, shadowsOnSave: true, yaml: expect.stringContaining('name: Shipped') })
    expect(String(shipped.body.yaml)).not.toContain('pluginId')

    const missing = await call('GET', '/definitions/:name/raw', '/definitions/nope/raw', { searchParams: { name: 'nope' } })
    expect(missing.status).toBe(404)
  })

  it('a save that does not parse is refused with the line; one with an unknown key names the key; a good save is written verbatim', async () => {
    writeFileSync(join(defsDir, 'edit-me.yaml'), good)
    const broken = await call('PUT', '/definitions/:name/raw', '/definitions/edit-me/raw', { searchParams: { name: 'edit-me' }, body: { yaml: 'name: x\nsteps:\n  - id: [\n' } })
    expect(broken.status).toBe(400)
    expect(broken.body).toMatchObject({ error: expect.stringMatching(/YAML does not parse at line \d+/), parseError: { line: expect.any(Number) } })
    expect(readFileSync(join(defsDir, 'edit-me.yaml'), 'utf-8')).toBe(good) // nothing written

    const unknownKey = await call('PUT', '/definitions/:name/raw', '/definitions/edit-me/raw', { searchParams: { name: 'edit-me' }, body: { yaml: good.replace('agent: chef\n', 'agent: chef\n    bogus: 1\n') } })
    expect(unknownKey.status).toBe(400)
    expect(JSON.stringify(unknownKey.body.issues)).toContain('bogus')

    const commented = `# kept verbatim\n${good}`
    const saved = await call('PUT', '/definitions/:name/raw', '/definitions/edit-me/raw', { searchParams: { name: 'edit-me' }, body: { yaml: commented } })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ id: 'edit-me', source: 'user', definition: { name: 'Edit me' } })
    expect(readFileSync(join(defsDir, 'edit-me.yaml'), 'utf-8')).toBe(commented) // formatting and comments survive

    const empty = await call('PUT', '/definitions/:name/raw', '/definitions/edit-me/raw', { searchParams: { name: 'edit-me' }, body: { yaml: '   ' } })
    expect(empty.status).toBe(400)
  })
})

describe('GET/PUT /skills/:name/raw', () => {
  it('reads the file with the problems the health check would flag; a save is refused while they remain and lands when fixed', async () => {
    writeFileSync(join(skillsDir, 'review.md'), 'no frontmatter at all\n')
    const read = await call('GET', '/skills/:name/raw', '/skills/review.md/raw')
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ name: 'review.md', content: 'no frontmatter at all\n', problems: [{ section: 'frontmatter' }, { section: 'output_schema' }] })

    const stillBroken = await call('PUT', '/skills/:name/raw', '/skills/review.md/raw', { body: { content: '---\nname: Review\n---\nbody\n' } })
    expect(stillBroken.status).toBe(400)
    expect(stillBroken.body).toMatchObject({ problems: [{ section: 'output_schema' }] })
    expect(readFileSync(join(skillsDir, 'review.md'), 'utf-8')).toBe('no frontmatter at all\n')

    const fixed = '---\nname: Review\noutput_schema:\n  type: object\n---\nbody'
    const saved = await call('PUT', '/skills/:name/raw', '/skills/review.md/raw', { body: { content: fixed } })
    expect(saved.status).toBe(200)
    expect(readFileSync(join(skillsDir, 'review.md'), 'utf-8')).toBe(`${fixed}\n`)
  })

  it('the save route shares the health check\'s verdict (Codex r2 #11): malformed frontmatter YAML and a prose-only or list output_schema are refused, and the GET names the same problems', async () => {
    writeFileSync(join(skillsDir, 'torn.md'), '---\nname: Torn\n---\nbody\n')
    const malformed = '---\nname: [\n---\nRemember the output_schema.\n'
    const refused = await call('PUT', '/skills/:name/raw', '/skills/torn.md/raw', { body: { content: malformed } })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ problems: [{ section: 'frontmatter', code: 'frontmatter-invalid-yaml' }, { section: 'output_schema', code: 'output-schema-missing' }] })
    expect(String((refused.body as { error: string }).error)).toMatch(/not valid YAML/)
    expect(readFileSync(join(skillsDir, 'torn.md'), 'utf-8')).toBe('---\nname: Torn\n---\nbody\n')

    const prose = await call('PUT', '/skills/:name/raw', '/skills/torn.md/raw', { body: { content: '---\nname: Torn\n---\nThe output_schema is described in prose.\n' } })
    expect(prose.status).toBe(400)
    expect(prose.body).toMatchObject({ problems: [{ section: 'output_schema', code: 'output-schema-missing' }] })

    const listy = await call('PUT', '/skills/:name/raw', '/skills/torn.md/raw', { body: { content: '---\nname: Torn\noutput_schema: [a, b]\n---\nbody\n' } })
    expect(listy.status).toBe(400)
    expect(listy.body).toMatchObject({ problems: [{ section: 'output_schema', code: 'output-schema-not-mapping' }] })

    writeFileSync(join(skillsDir, 'torn.md'), malformed)
    const read = await call('GET', '/skills/:name/raw', '/skills/torn.md/raw')
    expect(read.body).toMatchObject({ problems: [{ section: 'frontmatter', code: 'frontmatter-invalid-yaml' }, { section: 'output_schema' }] })
  })

  it('refuses names that are not a skill file (no traversal) and a file that does not exist', async () => {
    expect((await call('GET', '/skills/:name/raw', '/skills/..%2F..%2Fsettings.json/raw')).status).toBe(400)
    expect((await call('GET', '/skills/:name/raw', '/skills/nope.md/raw')).status).toBe(404)
    expect((await call('PUT', '/skills/:name/raw', '/skills/nope.md/raw', { body: { content: '---\noutput_schema: {}\n---\nx' } })).status).toBe(404)
  })
})
