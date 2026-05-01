/**
 * Agent-package manifest schema (`bakin-package.json`).
 *
 * One manifest covers all four package kinds — `agent`, `skill-pack`,
 * `workflow-pack`, `knowledge-pack` — discriminated by the `kind` field.
 * Kind-specific stanzas (`agent`, `install`) only attach to `kind: "agent"`.
 *
 * This module is pure: zod schemas + parser entry points only. No filesystem
 * access. The installer in `src/core/agent-packages/installer.ts` is the
 * caller that turns a parsed manifest into projected files.
 */
import { z } from 'zod'

// ─── Identifiers + sources ───────────────────────────────────────────────────

/** Package id pattern — same shape as plugin ids (see `plugin-install.ts`). */
const PackageIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-_]{0,39}$/i, {
    message: 'id must match /^[a-z0-9][a-z0-9-_]{0,39}$/i',
  })

/** Lesson id pattern — same shape as package ids. Used for knowledge files. */
const LessonIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-_]{0,39}$/i, {
    message: 'lesson id must match /^[a-z0-9][a-z0-9-_]{0,39}$/i',
  })

/** Loose semver — `MAJOR.MINOR.PATCH` with optional prerelease tag. */
const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, {
    message: 'version must be MAJOR.MINOR.PATCH (optional -prerelease)',
  })

/**
 * Dependency source. Allowed forms:
 *   - github:user/repo                         (no ref — installer resolves to default branch SHA)
 *   - github:user/repo (with `ref` field)      (tag/branch/commit-SHA)
 *   - ./relative/path or /absolute/path        (local source)
 */
const SourceSchema = z
  .string()
  .min(1)
  .refine(
    (s) =>
      s.startsWith('github:') ||
      s.startsWith('./') ||
      s.startsWith('../') ||
      s.startsWith('/') ||
      s.startsWith('~/'),
    { message: "source must be 'github:user/repo' or a local path (./, ../, /, ~/)" },
  )

const DependencySchema = z.object({
  source: SourceSchema,
  ref: z.string().min(1),
  /** Filter to a subset of items the dependency exposes. Undefined → all. */
  items: z.array(z.string().min(1)).optional(),
  /** Optional alias if the depended-upon item collides with another at the projection target. */
  installAs: z.string().min(1).nullable().optional(),
})

const DependenciesSchema = z
  .object({
    skills: z.array(DependencySchema).optional(),
    workflows: z.array(DependencySchema).optional(),
    knowledge: z.array(DependencySchema).optional(),
  })
  .optional()

// ─── Agent + install stanzas ─────────────────────────────────────────────────

const IdentitySchema = z.object({
  name: z.string().min(1),
  emoji: z.string().optional(),
})

const AgentStanzaSchema = z.object({
  identity: IdentitySchema,
  role: z.string().optional(),
  defaultModel: z.string().optional(),
  /** Agents allowed to dispatch tasks to this one. `["main"]` is typical. */
  dispatchableBy: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  /**
   * Declarative MCP-tool allow-list. Bakin's MCP server reads installed
   * agent-package manifests and enforces this at listing and invocation time.
   */
  allowedTools: z.array(z.string().min(1)).optional(),
  /** Declarative skill allow-list. Documentation-only until skill routing exists. */
  allowedSkills: z.array(z.string().min(1)).optional(),
})

const InstallStanzaSchema = z.object({
  /** Create the runtime agent if no agent with this id exists. */
  createIfMissing: z.boolean().optional(),
  /** If an agent with this id already exists, adopt rather than refuse. */
  adoptIfExists: z.boolean().optional(),
  /** Write template workspace files (SOUL/IDENTITY/AGENTS/TOOLS) on fresh install. */
  writeWorkspaceFiles: z.boolean().optional(),
  installSkills: z.boolean().optional(),
  installWorkflows: z.boolean().optional(),
  /** Lessons that auto-enable on install. Anything here gets a knowledge block injected by default. */
  enableKnowledge: z.array(LessonIdSchema).optional(),
})

// ─── Per-kind contributions ──────────────────────────────────────────────────

const AgentContributionsSchema = z.object({
  workspaceFiles: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  workflows: z.array(z.string().min(1)).optional(),
  workflowSkills: z.array(z.string().min(1)).optional(),
  knowledge: z.array(z.string().min(1)).optional(),
  assets: z.array(z.string().min(1)).optional(),
})

const SkillPackContributionsSchema = z.object({
  skills: z.array(z.string().min(1)).min(1, {
    message: 'skill-pack must contribute at least one skill',
  }),
  assets: z.array(z.string().min(1)).optional(),
})

const WorkflowPackContributionsSchema = z
  .object({
    workflows: z.array(z.string().min(1)).optional(),
    workflowSkills: z.array(z.string().min(1)).optional(),
    assets: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (c) => (c.workflows?.length ?? 0) + (c.workflowSkills?.length ?? 0) > 0,
    { message: 'workflow-pack must contribute at least one workflow or workflow-skill' },
  )

const KnowledgePackContributionsSchema = z.object({
  knowledge: z.array(z.string().min(1)).min(1, {
    message: 'knowledge-pack must contribute at least one knowledge file',
  }),
  assets: z.array(z.string().min(1)).optional(),
})

// ─── Discriminated manifest schemas ──────────────────────────────────────────

const BaseManifestFields = {
  id: PackageIdSchema,
  name: z.string().min(1),
  version: SemverSchema,
  description: z.string().optional(),
  /** Bakin version range the package is compatible with (semver range). Cosmetic in V1. */
  bakin: z.string().optional(),
  author: z.string().optional(),
}

export const AgentManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('agent'),
  agent: AgentStanzaSchema,
  install: InstallStanzaSchema,
  contributions: AgentContributionsSchema,
  dependencies: DependenciesSchema,
})

export const SkillPackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('skill-pack'),
  contributions: SkillPackContributionsSchema,
  dependencies: DependenciesSchema,
})

export const WorkflowPackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('workflow-pack'),
  contributions: WorkflowPackContributionsSchema,
  dependencies: DependenciesSchema,
})

export const KnowledgePackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('knowledge-pack'),
  contributions: KnowledgePackContributionsSchema,
  dependencies: DependenciesSchema,
})

export const ManifestSchema = z.discriminatedUnion('kind', [
  AgentManifestSchema,
  SkillPackManifestSchema,
  WorkflowPackManifestSchema,
  KnowledgePackManifestSchema,
])

// ─── Inferred TypeScript types (the canonical surface) ───────────────────────

export type AgentManifest = z.infer<typeof AgentManifestSchema>
export type SkillPackManifest = z.infer<typeof SkillPackManifestSchema>
export type WorkflowPackManifest = z.infer<typeof WorkflowPackManifestSchema>
export type KnowledgePackManifest = z.infer<typeof KnowledgePackManifestSchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type Dependency = z.infer<typeof DependencySchema>
export type PackageKind = Manifest['kind']

// ─── Parse entry points ──────────────────────────────────────────────────────

/**
 * Parse a `bakin-package.json` payload. Throws on invalid input.
 * Use `safeParseManifest` when you want to handle the error path explicitly.
 */
export function parseManifest(input: unknown): Manifest {
  return ManifestSchema.parse(input)
}

export type ParseResult =
  | { success: true; data: Manifest }
  | { success: false; error: z.ZodError }

export function safeParseManifest(input: unknown): ParseResult {
  const result = ManifestSchema.safeParse(input)
  if (result.success) return { success: true, data: result.data }
  return { success: false, error: result.error }
}

/**
 * Format a zod error into a single-line human-readable string.
 * Used by CLI + REST handlers to produce error messages.
 */
export function formatManifestError(error: z.ZodError): string {
  const issues = error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join('.') : '<root>'
    return `${path}: ${i.message}`
  })
  return issues.join('; ')
}
