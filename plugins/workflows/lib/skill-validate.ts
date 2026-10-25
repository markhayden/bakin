/**
 * The ONE verdict on a workflow skill file (Codex r2 #11): what the engine's
 * loader needs — a YAML frontmatter block that PARSES to a mapping, and an
 * `output_schema` mapping inside it. The health check (rows 127/128) and
 * the raw save route read this same function, so a save the route accepts
 * is a file the check stops flagging, and a prose mention of `output_schema`
 * or malformed YAML satisfies neither.
 */
import { load } from 'js-yaml'
import { splitFrontmatter } from '@bakin/core/format/frontmatter'

export type SkillProblemSection = 'frontmatter' | 'output_schema'

export interface SkillProblem {
  section: SkillProblemSection
  /** Stable code for tests and evidence; `message` is the operator's copy. */
  code: 'frontmatter-missing' | 'frontmatter-invalid-yaml' | 'frontmatter-not-mapping' | 'name-not-string' | 'output-schema-missing' | 'output-schema-not-mapping'
  message: string
}

export interface SkillSourceVerdict {
  problems: SkillProblem[]
  /** The parsed frontmatter mapping, or null when there is none that parses. */
  frontmatter: Record<string, unknown> | null
}

const isMapping = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const NO_SCHEMA: SkillProblem = { section: 'output_schema', code: 'output-schema-missing', message: 'The frontmatter declares no output_schema.' }

export function validateWorkflowSkillSource(content: string): SkillSourceVerdict {
  const { raw } = splitFrontmatter(content)
  if (raw === null) {
    return { problems: [{ section: 'frontmatter', code: 'frontmatter-missing', message: 'The file has no YAML frontmatter (a `---` block at the top).' }, NO_SCHEMA], frontmatter: null }
  }
  let parsed: unknown
  try {
    parsed = raw.trim() === '' ? {} : load(raw)
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { problems: [{ section: 'frontmatter', code: 'frontmatter-invalid-yaml', message: `The frontmatter is not valid YAML: ${reason}` }, NO_SCHEMA], frontmatter: null }
  }
  if (!isMapping(parsed)) {
    return { problems: [{ section: 'frontmatter', code: 'frontmatter-not-mapping', message: 'The frontmatter must be a YAML mapping (`key: value` lines), not a list or a scalar.' }, NO_SCHEMA], frontmatter: null }
  }
  const problems: SkillProblem[] = []
  if (parsed.name !== undefined && typeof parsed.name !== 'string') {
    problems.push({ section: 'frontmatter', code: 'name-not-string', message: 'The frontmatter `name` must be a string.' })
  }
  if (parsed.output_schema === undefined) problems.push(NO_SCHEMA)
  else if (!isMapping(parsed.output_schema)) {
    problems.push({ section: 'output_schema', code: 'output-schema-not-mapping', message: `The output_schema must be a mapping (a JSON-schema object), not ${Array.isArray(parsed.output_schema) ? 'a list' : `a ${typeof parsed.output_schema}`}.` })
  }
  return { problems, frontmatter: parsed }
}
