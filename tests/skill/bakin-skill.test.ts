import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderBakinRuntimeSkill } from '../../src/core/bakin-skill'

describe('Bakin runtime skill', () => {
  it('documents portable mcporter command patterns', () => {
    const skill = readFileSync(join(process.cwd(), 'skill', 'SKILL.md'), 'utf-8')

    expect(skill).toContain('grep -n -E')
    expect(skill).toContain('Do not use `--args @-`, heredocs, process substitution, or stdin-fed JSON')
    expect(skill).toContain('mcporter call bakin-main.bakin_exec_projects_get --args')
    expect(skill).toContain('ARGS=$(node -e')
    expect(skill).toContain('mcporter call bakin-main.bakin_exec_projects_apply_plan --args "$ARGS"')
    expect(skill).toContain('http://localhost:3737')
    expect(skill).toContain('$HOME/.local/bin/bakin')
  })

  it('renders from the embedded template outside a source checkout', async () => {
    const notARepo = await mkdtemp(join(tmpdir(), 'bakin-skill-no-source-'))

    const rendered = renderBakinRuntimeSkill(notARepo)

    expect(rendered).toContain('Bakin is the local task, project, agent, workflow, asset, schedule')
    expect(rendered).toContain('http://localhost:3737')
    expect(rendered).toContain('mcporter list bakin-main --schema')
  })
})
