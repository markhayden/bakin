import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

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
})
