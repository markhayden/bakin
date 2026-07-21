import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

import { classifyUiImpact } from '../../../scripts/ui/ci-impact.mjs'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('UI CI impact classification', () => {
  it('skips only known docs and planning-only changes', () => {
    expect(classifyUiImpact([
      'docs/src/content/docs/getting-started.md',
      '.claude/specs/example/SPEC.md',
      'tasks/todo-example.md',
    ])).toEqual({ runUi: false, reason: 'docs-or-planning-only' })
  })

  it('runs the full suite for UI, shared dependency, workflow, and mixed changes', () => {
    for (const files of [
      ['packages/host/src/app.tsx'],
      ['plugins/tasks/client.tsx'],
      ['package.json'],
      ['.github/workflows/ci-pr.yml'],
      ['docs/src/content/docs/index.md', 'src/core/server.ts'],
    ]) {
      expect(classifyUiImpact(files)).toEqual({ runUi: true, reason: 'ui-or-uncertain-impact' })
    }
  })

  it('fails conservative for empty and unknown change sets', () => {
    expect(classifyUiImpact([])).toEqual({ runUi: true, reason: 'empty-change-set' })
    expect(classifyUiImpact(['unknown.generated'])).toEqual({ runUi: true, reason: 'ui-or-uncertain-impact' })
  })
})

describe('reusable UI workflow', () => {
  it('keeps every edited workflow valid YAML with the expected job graph', () => {
    const workflows = [
      '.github/workflows/ui-visual.yml',
      '.github/workflows/ci-pr.yml',
      '.github/workflows/ci-main.yml',
      '.github/workflows/release.yml',
    ].map((path) => yaml.load(readRepoFile(path), { schema: yaml.JSON_SCHEMA }) as {
      on?: Record<string, unknown>
      jobs?: Record<string, { needs?: string[] }>
    })

    for (const workflow of workflows) expect(workflow.jobs).toBeDefined()
    expect(workflows[0].on?.workflow_call).toBeDefined()
    expect(workflows[3].jobs?.publish?.needs).toContain('ui')
  })

  it('runs every public catalog gate and retains actionable artifacts', () => {
    const workflow = readRepoFile('.github/workflows/ui-visual.yml')

    for (const command of [
      'ui:tokens:check',
      'ui:public-api:check',
      'ui:build:public:verify',
      'ui:test:stories',
      'ui:test:visual',
      'ui:test:browsers',
    ]) expect(workflow).toContain(`bun run ${command}`)

    for (const artifactPath of [
      'test-results/ui-stories',
      'playwright-report/ui',
      'test-results/ui-visual',
      'playwright-report/ui-browser',
      'test-results/ui-browser',
    ]) expect(workflow).toContain(artifactPath)

    expect(workflow).toContain('checkout_ref:')
    expect(workflow).not.toContain('update-snapshots')
  })

  it('is path-aware on PRs and unconditional on main and release refs', () => {
    const pullRequest = readRepoFile('.github/workflows/ci-pr.yml')
    const main = readRepoFile('.github/workflows/ci-main.yml')
    const release = readRepoFile('.github/workflows/release.yml')

    expect(pullRequest).toContain('node scripts/ui/ci-impact.mjs')
    expect(pullRequest).toContain("needs.impact.outputs.run_ui == 'true'")
    expect(main).toContain('uses: ./.github/workflows/ui-visual.yml')
    expect(release).toContain('uses: ./.github/workflows/ui-visual.yml')
    expect(release).toContain('checkout_ref: ${{ needs.gate.outputs.commit }}')
  })
})

describe('Storybook CI diagnostics', () => {
  it('writes a JUnit report and retains Playwright traces on failure', () => {
    const config = readRepoFile('vitest.config.ts')

    expect(config).toContain("['junit', { outputFile: 'test-results/ui-stories/junit.xml' }]")
    expect(config).toContain("mode: 'retain-on-failure'")
    expect(config).toContain("tracesDir: 'test-results/ui-stories/traces'")
  })
})
