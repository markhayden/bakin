import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// Read-only skill-render suite (no storage writes), but the isolation guard
// requires the content-dir resolvers be mocked so nothing can ever leak.
const testDir = join(tmpdir(), `bakin-test-skill-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { renderBakinRuntimeSkill } from '../../src/core/bakin-skill'

describe('Bakin runtime skill', () => {
  it('is transport-neutral — names tools, defers invocation to the Tool access section', () => {
    const skill = readFileSync(join(process.cwd(), 'skill', 'SKILL.md'), 'utf-8')

    // No transport / runtime specifics leak into the static template (P1.4).
    expect(skill).not.toContain('mcporter')
    expect(skill).not.toContain('OpenClaw')
    // Points agents at the injected, runtime-specific Tool access section.
    expect(skill).toContain('**Tool access**')
    expect(skill).toContain('bakin_exec_')
    expect(skill).toContain('http://localhost:3737')
    expect(skill).toContain('$HOME/.local/bin/bakin')
  })

  it('renders from the embedded template outside a source checkout', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'bakin-skill-no-source-'))

    const rendered = renderBakinRuntimeSkill(notARepo)

    expect(rendered).toContain('Bakin is the local task, project, agent, workflow, asset, schedule')
    expect(rendered).toContain('http://localhost:3737')
    expect(rendered).not.toContain('mcporter')
  })
})
