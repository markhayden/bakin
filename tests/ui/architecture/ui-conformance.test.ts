import { afterEach, describe, expect, it } from 'bun:test'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

import {
  conformanceCommands,
  validateUiExceptionDocument,
  type UiExceptionDocument,
} from '../../../scripts/ui/conformance'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const tempRoots: string[] = []

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-ui-conformance-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'storybook/public/patterns'), { recursive: true })
  mkdirSync(join(root, 'plugins/example/components'), { recursive: true })
  writeFileSync(
    join(root, 'storybook/public/patterns/example.stories.tsx'),
    "export default { title: 'Patterns/Example', tags: ['public'] }\nexport const Default = {}\n",
  )
  writeFileSync(join(root, 'plugins/example/components/example.tsx'), 'export function Example() { return null }\n')
  return root
}

function validException(): UiExceptionDocument['exceptions'][number] {
  return {
    id: 'example-domain-canvas',
    status: 'approved-temporary',
    scope: ['plugins/example/components/example.tsx'],
    closestPattern: {
      storyPath: 'storybook/public/patterns/example.stories.tsx',
      storyExport: 'Default',
    },
    mismatch: 'The domain canvas needs free-positioned nodes that the bounded list pattern does not model.',
    compositionLimit: 'Composing the existing pattern would remove spatial relationships that are core domain data.',
    alternative: 'Keep the canvas domain-owned while composing SDK controls, feedback, and bounded overflow around it.',
    safeguards: {
      accessibility: 'Provide keyboard node selection and an equivalent ordered representation of every connection.',
      responsiveness: 'Contain two-dimensional overflow locally and preserve every primary action at 320 CSS pixels.',
      routing: 'Keep selected-node state in the existing query-state contract and preserve browser history behavior.',
      isolation: 'Scope every domain selector beneath the injected plugin ownership root and reuse the host stylesheet.',
    },
    approvedBy: 'Product owner',
    approvedOn: '2026-07-21',
    approvalEvidence: 'Approved in the design-system review before implementation began.',
    reviewBy: '2026-10-21',
    removalCondition: 'Remove this exception when a public spatial-workflow pattern covers free-positioned domain nodes.',
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('UI exception governance', () => {
  it('accepts a concrete, approved, reviewable deviation tied to a public story', () => {
    const root = makeFixtureRoot()
    const document: UiExceptionDocument = {
      schemaVersion: 1,
      policy: 'Storybook-first; deviations require explicit user approval and concrete evidence.',
      exceptions: [validException()],
    }

    expect(validateUiExceptionDocument(document, root, new Date('2026-07-22T00:00:00Z'))).toEqual([])
  })

  it('rejects generic rationale, missing stories, unsafe scope, duplicates, and expired approval', () => {
    const root = makeFixtureRoot()
    const invalid = validException()
    invalid.mismatch = 'It is custom.'
    invalid.compositionLimit = 'Looks better.'
    invalid.closestPattern.storyExport = 'Missing'
    invalid.scope = ['../outside.tsx']
    invalid.reviewBy = '2026-07-20'
    const document: UiExceptionDocument = {
      schemaVersion: 1,
      policy: 'Storybook-first; deviations require explicit user approval and concrete evidence.',
      exceptions: [invalid, { ...invalid }],
    }

    const errors = validateUiExceptionDocument(document, root, new Date('2026-07-22T00:00:00Z'))
    expect(errors.some((error) => error.includes('duplicate exception id'))).toBe(true)
    expect(errors.some((error) => error.includes('mismatch must explain'))).toBe(true)
    expect(errors.some((error) => error.includes('compositionLimit must explain'))).toBe(true)
    expect(errors.some((error) => error.includes('storyExport Missing'))).toBe(true)
    expect(errors.some((error) => error.includes('scope path escapes'))).toBe(true)
    expect(errors.some((error) => error.includes('reviewBy is expired'))).toBe(true)
  })

  it('rejects impossible dates and approvals dated after the validation day', () => {
    const root = makeFixtureRoot()
    const impossible = validException()
    impossible.id = 'impossible-date'
    impossible.approvedOn = '2026-02-30'
    impossible.reviewBy = '2026-13-01'
    const future = validException()
    future.id = 'future-approval'
    future.approvedOn = '2026-07-23'
    future.reviewBy = '2026-10-23'
    const document: UiExceptionDocument = {
      schemaVersion: 1,
      policy: 'Storybook-first; deviations require explicit user approval and concrete evidence.',
      exceptions: [impossible, future],
    }

    const errors = validateUiExceptionDocument(document, root, new Date('2026-07-22T00:00:00Z'))
    expect(errors.some((error) => error.includes('impossible-date approvedOn is not a valid calendar date'))).toBe(true)
    expect(errors.some((error) => error.includes('impossible-date reviewBy is not a valid calendar date'))).toBe(true)
    expect(errors.some((error) => error.includes('future-approval approvedOn is in the future'))).toBe(true)
  })

  it('rejects scopes and stories that resolve outside the repository through symlinks', () => {
    const root = makeFixtureRoot()
    const outside = mkdtempSync(join(tmpdir(), 'bakin-ui-conformance-outside-'))
    tempRoots.push(outside)
    writeFileSync(join(outside, 'external.tsx'), 'export const Default = {}\n')
    symlinkSync(join(outside, 'external.tsx'), join(root, 'plugins/example/components/external.tsx'))
    symlinkSync(join(outside, 'external.tsx'), join(root, 'storybook/public/patterns/external.stories.tsx'))
    const exception = validException()
    exception.id = 'external-symlink'
    exception.scope = ['plugins/example/components/external.tsx']
    exception.closestPattern.storyPath = 'storybook/public/patterns/external.stories.tsx'
    const document: UiExceptionDocument = {
      schemaVersion: 1,
      policy: 'Storybook-first; deviations require explicit user approval and concrete evidence.',
      exceptions: [exception],
    }

    const errors = validateUiExceptionDocument(document, root, new Date('2026-07-22T00:00:00Z'))
    expect(errors.some((error) => error.includes('scope path resolves outside'))).toBe(true)
    expect(errors.some((error) => error.includes('story resolves outside'))).toBe(true)
  })
})

describe('one-command UI conformance', () => {
  it('keeps quick checks deterministic and full checks a strict superset', () => {
    const quick = conformanceCommands('quick').map((step) => step.command.join(' '))
    const full = conformanceCommands('full').map((step) => step.command.join(' '))

    for (const command of [
      'bun run ui:tokens:check',
      'bun run ui:public-api:check',
      'bun run ui:census:check',
      'bun run ui:legacy-styles:check',
      'bun test tests/ui/architecture --isolate',
      'bun run typecheck',
    ]) expect(quick).toContain(command)

    for (const command of quick) expect(full).toContain(command)
    for (const command of [
      'bun run lint',
      'bun run test',
      'bun run build:css',
      'bun run build:vendors',
      'bun run ui:performance',
      'bun run ui:build:public:verify',
      'bun run ui:test:stories',
      'bun run ui:test:visual',
      'bun run ui:test:browsers',
      'bun run ui:test:conformance',
      'bun run docs:check',
    ]) expect(full).toContain(command)

    expect(full.indexOf('bun run build:css')).toBeLessThan(full.indexOf('bun run test'))
    expect(full.some((command) => /generate|update-snapshots/.test(command))).toBe(false)
  })

  it('wires governance into local commands and every relevant CI path', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }
    expect(manifest.scripts['ui:governance:check']).toContain('conformance.ts governance')
    expect(manifest.scripts['ui:conformance']).toContain('conformance.ts')

    for (const workflow of [
      '.github/workflows/ci-main.yml',
      '.github/workflows/ci-pr.yml',
      '.github/workflows/docs-deploy.yml',
      '.github/workflows/ui-visual.yml',
    ]) expect(readRepoFile(workflow)).toContain('bun run ui:governance:check')
  })
})

describe('Claude and Codex UI skill discovery', () => {
  it('uses one canonical skill for both agents', () => {
    const claudeSkill = '.claude/skills/bakin-ui-conformance/SKILL.md'
    const codexSkill = join(REPO_ROOT, '.agents/skills/bakin-ui-conformance')
    expect(lstatSync(codexSkill).isSymbolicLink()).toBe(true)
    expect(readlinkSync(codexSkill)).toBe('../../.claude/skills/bakin-ui-conformance')
    expect(readRepoFile('.agents/skills/bakin-ui-conformance/SKILL.md')).toBe(readRepoFile(claudeSkill))
  })

  it('requires Storybook-first selection and a concrete approved deviation protocol', () => {
    const skill = readRepoFile('.claude/skills/bakin-ui-conformance/SKILL.md')
    for (const phrase of [
      'closest public Storybook pattern',
      'exact mismatch',
      'why composition and documented escape hatches are insufficient',
      'explicit user approval',
      'accessibility, responsiveness, routing, and plugin isolation',
      'design-system/exceptions.json',
      'bun run ui:conformance --quick',
      'bun run ui:conformance --full',
    ]) expect(skill).toContain(phrase)
    expect(skill).toContain('Do not accept “custom,” “easier,” “looks better,” or “existing code”')
  })

  it('publishes valid Codex interface metadata for the canonical skill', () => {
    const config = yaml.load(
      readRepoFile('.claude/skills/bakin-ui-conformance/agents/openai.yaml'),
      { schema: yaml.JSON_SCHEMA },
    ) as { interface?: { display_name?: string; short_description?: string; default_prompt?: string } }

    expect(config.interface?.display_name).toBe('Bakin UI Conformance')
    expect(config.interface?.short_description?.length).toBeGreaterThanOrEqual(25)
    expect(config.interface?.short_description?.length).toBeLessThanOrEqual(64)
    expect(config.interface?.default_prompt).toContain('$bakin-ui-conformance')
  })

  it('makes UI skill use mandatory and retires contradictory legacy component guidance', () => {
    const claude = readRepoFile('CLAUDE.md')
    const agents = readRepoFile('AGENTS.md')
    const addComponent = readRepoFile('.claude/skills/add-component.md')
    const auditPlugin = readRepoFile('.claude/skills/audit-plugin.md')

    expect(claude).toContain('.claude/skills/bakin-ui-conformance/SKILL.md')
    expect(agents).toContain('.agents/skills/bakin-ui-conformance/SKILL.md')
    expect(addComponent).toContain('bakin-ui-conformance/SKILL.md')
    expect(addComponent).not.toContain('bg-card')
    expect(addComponent).not.toContain('src/components/ui/{name}.tsx')
    expect(auditPlugin).toContain('bakin-ui-conformance/SKILL.md')
  })

  it('keeps plugin authoring skills on the runtime-loader and public-SDK architecture', () => {
    const createPlugin = readRepoFile('.claude/skills/create-plugin.md')
    const auditPlugin = readRepoFile('.claude/skills/audit-plugin.md')

    expect(createPlugin).toContain('bakin plugins scaffold')
    expect(createPlugin).toContain('bakin plugins link')
    expect(createPlugin).toContain('bakin plugins sync-manifest --check')
    expect(createPlugin).not.toContain('src/app/{id}/page.tsx')
    expect(createPlugin).not.toContain('src/lib/plugin-manifest.ts')
    expect(createPlugin).not.toContain("from '@bakin/core")
    expect(auditPlugin).toContain('path = page identity')
    expect(auditPlugin).toContain('query = overlays')
    expect(auditPlugin).not.toContain('src/app/{pluginId}/page.tsx')
    expect(auditPlugin).not.toContain('migrate `?id=X`')
  })
})

describe('reviewed guidance consistency', () => {
  it('preserves the recent routing contract and focused visual entrypoints', () => {
    const styleGuide = readRepoFile('.claude/knowledge/style-guide.md')
    const claude = readRepoFile('CLAUDE.md')
    const sdkGuide = readRepoFile('docs/src/content/docs/extending/sdk/overview.md')

    expect(styleGuide).toContain("`?id=123` stays the string `'123'`")
    expect(styleGuide).not.toContain('search params are JSON-parsed')
    expect(claude).toContain("import { PageHeader } from '@makinbakin/sdk/patterns'")
    expect(claude).not.toContain("import { PluginHeader } from '@makinbakin/sdk/components'")
    expect(sdkGuide).toContain("} from '@makinbakin/sdk/conversation'")
  })
})
