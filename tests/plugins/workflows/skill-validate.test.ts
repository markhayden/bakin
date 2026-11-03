/**
 * The ONE skill-file verdict (Codex r2 #11): frontmatter must PARSE to a
 * mapping and carry an `output_schema` mapping — a prose mention or a list
 * does not count. Shared by the raw save route and the skills health check.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure module; the content-dir resolvers are mocked per the repo-wide isolation rule.
const testDir = join(tmpdir(), `bakin-test-skill-validate-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))

import { validateWorkflowSkillSource } from '../../../plugins/workflows/lib/skill-validate'

const codes = (content: string) => validateWorkflowSkillSource(content).problems.map((p) => p.code)

describe('validateWorkflowSkillSource', () => {
  it('a valid skill has no problems and exposes the parsed frontmatter', () => {
    const verdict = validateWorkflowSkillSource('---\nname: Review\noutput_schema:\n  type: object\n  required: [summary]\n---\nDo the review.\n')
    expect(verdict.problems).toEqual([])
    expect(verdict.frontmatter).toMatchObject({ name: 'Review', output_schema: { type: 'object', required: ['summary'] } })
  })
  it('no frontmatter block at all: both sections are missing', () => {
    expect(codes('just prose that mentions output_schema\n')).toEqual(['frontmatter-missing', 'output-schema-missing'])
  })
  it('malformed YAML in the frontmatter is refused even when the body mentions output_schema in prose', () => {
    const verdict = validateWorkflowSkillSource('---\nname: [\n---\nRemember the output_schema.\n')
    expect(verdict.problems.map((p) => p.code)).toEqual(['frontmatter-invalid-yaml', 'output-schema-missing'])
    expect(verdict.problems[0]!.message).toMatch(/not valid YAML/)
    expect(verdict.frontmatter).toBeNull()
  })
  it('a frontmatter that parses to a list or a scalar is not a mapping', () => {
    expect(codes('---\n- a\n- b\n---\nbody\n')).toEqual(['frontmatter-not-mapping', 'output-schema-missing'])
    expect(codes('---\njust a string\n---\nbody\n')).toEqual(['frontmatter-not-mapping', 'output-schema-missing'])
  })
  it('output_schema mentioned only in prose, or declared as a list / scalar, is not a schema', () => {
    expect(codes('---\nname: X\n---\nUse the output_schema below.\n')).toEqual(['output-schema-missing'])
    expect(codes('---\nname: X\noutput_schema: [a, b]\n---\nbody\n')).toEqual(['output-schema-not-mapping'])
    expect(codes('---\nname: X\noutput_schema: yes please\n---\nbody\n')).toEqual(['output-schema-not-mapping'])
    expect(validateWorkflowSkillSource('---\nname: X\noutput_schema: [a]\n---\n').problems[0]!.message).toContain('not a list')
  })
  it('an empty frontmatter block is a mapping with nothing in it; a non-string name is flagged beside the schema verdict', () => {
    expect(codes('---\n\n---\nbody\n')).toEqual(['output-schema-missing'])
    expect(codes('---\nname: 42\noutput_schema: {}\n---\nbody\n')).toEqual(['name-not-string'])
  })
})
