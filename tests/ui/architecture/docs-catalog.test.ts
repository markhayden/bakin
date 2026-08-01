import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'

import {
  integratePublicUiCatalog,
  validatePublicUiCatalog,
} from '../../../scripts/docs/integrate-ui-catalog'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const tempRoots: string[] = []

function makeCatalogFixture(options: { internal?: boolean; brokenLink?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-docs-catalog-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'sb-manager'), { recursive: true })
  writeFileSync(join(root, 'sb-manager/runtime.js'), 'export const ready = true\n')
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n')
  writeFileSync(join(root, 'index.html'), [
    '<!doctype html>',
    '<link rel="icon" href="./favicon.svg">',
    `<script type="module" src="${options.brokenLink ? '../outside.js' : './sb-manager/runtime.js'}"></script>`,
  ].join('\n'))
  writeFileSync(join(root, 'iframe.html'), '<!doctype html><link rel="icon" href="./favicon.svg">\n')
  writeFileSync(join(root, 'bakin-fixtures.json'), '{}\n')
  writeFileSync(join(root, 'index.json'), `${JSON.stringify({
    v: 5,
    entries: {
      'foundation-button--default': {
        id: 'foundation-button--default',
        title: 'Foundation/Button',
        importPath: options.internal
          ? './storybook/internal/private.stories.tsx'
          : './storybook/public/foundation/button.stories.tsx',
        tags: options.internal ? ['internal'] : ['public'],
      },
    },
  })}\n`)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('combined docs and public UI catalog', () => {
  it('copies a validated public-only catalog under the docs artifact', () => {
    const catalogRoot = makeCatalogFixture()
    const docsDist = mkdtempSync(join(tmpdir(), 'bakin-docs-dist-'))
    tempRoots.push(docsDist)
    writeFileSync(join(docsDist, '404.html'), '<!doctype html>\n')

    const result = integratePublicUiCatalog({ catalogRoot, docsDist })

    expect(result).toEqual({ storyCount: 1, targetDir: join(docsDist, 'ui') })
    expect(existsSync(join(docsDist, 'ui/index.html'))).toBe(true)
    expect(validatePublicUiCatalog(join(docsDist, 'ui'))).toEqual({
      errors: [],
      storyCount: 1,
    })
  })

  it('rejects internal stories and static links that escape /docs/ui/', () => {
    const internal = validatePublicUiCatalog(makeCatalogFixture({ internal: true }))
    const broken = validatePublicUiCatalog(makeCatalogFixture({ brokenLink: true }))

    expect(internal.errors).toContain(
      'index.json: foundation-button--default is not tagged public',
    )
    expect(internal.errors).toContain(
      'index.json: foundation-button--default references an internal story source',
    )
    expect(broken.errors).toContain(
      'index.html: static reference ../outside.js escapes /docs/ui/',
    )
  })

  it('keeps docs routing validation and deployment on the existing release-ref artifact', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    const docsWorkflowText = readFileSync(join(REPO_ROOT, '.github/workflows/docs-deploy.yml'), 'utf-8')
    const docsWorkflow = yaml.load(docsWorkflowText, { schema: yaml.JSON_SCHEMA }) as {
      jobs?: { deploy?: { steps?: Array<{ uses?: string; run?: string; with?: Record<string, string> }> } }
    }
    const steps = docsWorkflow.jobs?.deploy?.steps ?? []
    const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'))
    const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))

    expect(packageJson.scripts['docs:check']).toContain('docs:validate:routes')
    expect(packageJson.scripts['docs:check']).toContain('docs:build:combined')
    expect(packageJson.scripts['docs:generate']).toContain('ui:tokens:generate')
    expect(readFileSync(join(REPO_ROOT, 'docs/astro.config.mjs'), 'utf-8')).toContain(
      "{ label: 'UI Tokens', slug: 'reference/generated/ui-tokens' }",
    )
    expect(checkout?.with?.ref).toBe('${{ inputs.version_ref || github.ref }}')
    expect(steps.some(step => step.run === 'bun run docs:check')).toBe(true)
    expect(upload?.with?.path).toBe('docs/dist')
    expect(docsWorkflowText).not.toContain('storybook-static')
  })
})
