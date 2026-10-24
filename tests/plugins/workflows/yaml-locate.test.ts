/** `locateYamlLine` / `locateSkillSectionLine`: the recover editor's cursor (self-healing PR1, Codex r1 #7). Pure. */
import { describe, expect, it } from 'bun:test'
import { locateSkillSectionLine, locateYamlLine } from '../../../plugins/workflows/lib/yaml-locate'

const yaml = [
  '# a comment',            // 1
  'name: Launch notes',     // 2
  'description: d',         // 3
  'steps:',                 // 4
  '  - id: s1',             // 5
  '    label: Draft',       // 6
  '    bogus: 1',           // 7
  '  - id: s2',             // 8
  '    type: parallel',     // 9
  '    steps:',             // 10
  '      - id: s2a',        // 11
  '        skill: write',   // 12
  '    skill: outer',       // 13
  'version: 1',             // 14
].join('\n')

describe('locateYamlLine', () => {
  it('finds top-level keys, items by index, keys inside items (inline on the dash line or below) and nested lists', () => {
    expect(locateYamlLine(yaml, 'name')).toBe(2)
    expect(locateYamlLine(yaml, 'version')).toBe(14)
    expect(locateYamlLine(yaml, 'steps')).toBe(4)
    expect(locateYamlLine(yaml, 'steps.0')).toBe(5)
    expect(locateYamlLine(yaml, 'steps.0.id')).toBe(5)
    expect(locateYamlLine(yaml, 'steps.0.bogus')).toBe(7)
    expect(locateYamlLine(yaml, 'steps.1.skill')).toBe(13) // not the nested item's skill
    expect(locateYamlLine(yaml, 'steps.1.steps.0.skill')).toBe(12)
  })
  it('follows the same-indent list style and returns null for a path that is not there', () => {
    expect(locateYamlLine('steps:\n- id: a\n- id: b\n  skill: x\nname: n', 'steps.1.skill')).toBe(4)
    expect(locateYamlLine(yaml, 'steps.0.label.nope')).toBeNull()
    expect(locateYamlLine(yaml, 'steps.9')).toBeNull()
    expect(locateYamlLine(yaml, 'missing')).toBeNull()
    expect(locateYamlLine(yaml, '')).toBeNull()
    expect(locateYamlLine(yaml, null)).toBeNull()
  })
})

describe('locateSkillSectionLine', () => {
  it('frontmatter → the top; output_schema → its line, else the closing fence, else the top', () => {
    expect(locateSkillSectionLine('body only', 'frontmatter')).toBe(1)
    expect(locateSkillSectionLine('---\nname: x\noutput_schema:\n  type: object\n---\nbody', 'output_schema')).toBe(3)
    expect(locateSkillSectionLine('---\nname: x\n---\nbody', 'output_schema')).toBe(3)
    expect(locateSkillSectionLine('no fence', 'output_schema')).toBe(1)
    expect(locateSkillSectionLine('x', null)).toBeNull()
  })
})
