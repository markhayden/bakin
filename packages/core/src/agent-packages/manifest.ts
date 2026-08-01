/**
 * Agent-package manifest schema (`bakin-package.json`).
 *
 * One manifest covers all four package kinds — `agent`, `skill-pack`,
 * `workflow-pack`, `lesson-pack` — discriminated by the `kind` field.
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

/** Lesson id pattern — same shape as package ids. Used for lesson files. */
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

/** Secret names are canonical environment variable names. Values never live in manifests. */
const SecretNameSchema = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/, {
    message: 'secret name must be an environment variable name',
  })

export const SecretDeclarationSchema = z.object({
  name: SecretNameSchema,
  description: z.string().min(1),
  required: z.boolean().default(true),
  /**
   * Secret-store slot (`<provider>.<secretName>`) the env var is filled from
   * at boot when unset. Drives the guided key prompt at install and the
   * Integrations & Keys remediation link. Absent → the env var is
   * user-managed only.
   */
  secretSlot: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,63}\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, {
      message: 'secretSlot must be "<provider>.<secretName>"',
    })
    .optional(),
  /** Where the user gets this credential (shown in install/consent/readiness UIs). */
  help: z.string().url().optional(),
})

// ─── Capability-pack extensions (skill-pack only) ────────────────────────────

/** Capability slug: names what the pack teaches agents (`web-search`, …). */
const CapabilitySlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, {
    message: 'capability must be a lowercase slug',
  })

/** Platform keys follow process.platform-process.arch (antfly pin convention). */
export const BIN_PLATFORM_KEYS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'] as const
export type BinPlatformKey = (typeof BIN_PLATFORM_KEYS)[number]

const BinDownloadSchema = z.object({
  // https only — except loopback (test fixtures / local dev registries).
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u),
      { message: 'bin download url must be https' },
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, { message: 'sha256 must be 64 hex chars' }),
  /**
   * Set when the download is an archive rather than the raw binary
   * (GitHub releases commonly ship tarballs). The sha256 pins the ARCHIVE;
   * `member` is the file extracted as the binary.
   */
  archive: z
    .object({
      format: z.literal('tar.gz'),
      member: z.string().min(1).refine((m) => !m.startsWith('/') && !m.startsWith('-') && !m.split('/').includes('..'), {
        message: 'archive member must be a relative path inside the archive (no leading - or /)',
      }),
    })
    .optional(),
})

const BinRequirementSchema = z.object({
  /** Binary name as invoked from PATH (installed into the Bakin bin dir). */
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, { message: 'bin name must be a safe slug' }),
  version: z.string().min(1),
  /** Pinned per-platform downloads. Missing key ⇒ unsupported platform (honest readiness failure). */
  install: z
    .partialRecord(z.enum(BIN_PLATFORM_KEYS), BinDownloadSchema)
    .refine((m) => Object.keys(m).length > 0, { message: 'at least one platform download required' }),
  /** Args for the verify-then-commit run (e.g. ["--version"]). Absent → no verify run. */
  verifyArgs: z.array(z.string()).optional(),
})

/** Pack-relative path: no absolute paths, no traversal above the pack root. */
const packRelativePath = (label: string) =>
  z.string().min(1).refine(
    (p) => !p.startsWith('/') && !p.split('/').includes('..'),
    { message: `${label} must be a pack-relative path (no absolute paths or ..)` },
  )

/** Exact semver pin — install reproducibility; ranges drift under our feet. */
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const NpmRequirementSchema = z.object({
  /** Payload name — becomes `<bakin-home>/npm/<packId>/<name>/` (unversioned so SKILL.md can reference it). */
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, { message: 'npm payload name must be a safe slug' }),
  /** Pack-relative dir whose files (scripts) are copied verbatim into the payload dir. */
  source: packRelativePath('npm payload source'),
  /** Exact-pinned dependencies installed into the payload dir (`bun install --ignore-scripts`). */
  dependencies: z.record(z.string(), z.string().regex(EXACT_SEMVER_RE, { message: 'npm dependency versions must be exact pins (1.2.3), not ranges' })),
  /** Env vars set for the dependency install run only (e.g. PUPPETEER_SKIP_DOWNLOAD). */
  env: z.record(z.string(), z.string()).optional(),
})

const ModelRequirementSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, { message: 'model name must be a safe slug' }),
  /** Direct download URL — same https-or-loopback rule as bin downloads. */
  url: BinDownloadSchema.shape.url,
  sha256: BinDownloadSchema.shape.sha256,
  /** Declared size — drives the install consent prompt; large models never surprise-download. */
  bytes: z.number().int().positive(),
  /** Destination relative to the Bakin models dir. */
  dest: packRelativePath('model dest'),
  /**
   * Env vars injected at server boot so the consuming binary finds the model
   * (secret-env pattern). The literal `{dest}` expands to the absolute path.
   */
  env: z.record(z.string(), z.string()).optional(),
})

const PrereqRequirementSchema = z
  .object({
    /** Human name shown in readiness/doctor findings. */
    name: z.string().min(1),
    kind: z.enum(['binary', 'app']),
    /** binary: a PATH lookup name. app: an absolute path that must exist. */
    probe: z.string().min(1),
    /** Where the user gets it — readiness remediation links here. */
    help: z.string().url(),
    /** Optional prereqs surface as a leg but never block readiness (default false). */
    optional: z.boolean().default(false),
  })
  .refine((p) => (p.kind === 'app' ? p.probe.startsWith('/') : !p.probe.includes('/')), {
    message: 'app probes must be absolute paths; binary probes must be bare PATH names',
  })

const RequiresSchema = z
  .object({
    bins: z.array(BinRequirementSchema).optional(),
    npm: z.array(NpmRequirementSchema).optional(),
    models: z.array(ModelRequirementSchema).optional(),
    /** Checked, never installed — external software the pack needs present. */
    prereqs: z.array(PrereqRequirementSchema).optional(),
  })
  .optional()

/**
 * Pack-level OS/arch gate. Omitted = every platform. A pack whose bins or
 * models only exist for some platforms declares them here so readiness
 * reports "not available for this platform" instead of "missing".
 */
const PlatformsSchema = z.array(z.enum(BIN_PLATFORM_KEYS)).min(1).optional()

/**
 * Runtime compatibility tags: `['*']` (default — skills are a cross-runtime
 * convention) or adapter names (`pi`, `openclaw`). Catalog/Explore filter and
 * badge against the ACTIVE runtime; install refuses incompatible packs.
 */
const RuntimesSchema = z
  .array(z.string().regex(/^(\*|[a-z0-9][a-z0-9-]{0,31})$/, { message: 'runtime tag must be "*" or an adapter slug' }))
  .min(1)
  .default(['*'])

/**
 * Dependency source. Allowed forms:
 *   - github:user/repo                         (no ref — installer resolves to default branch SHA)
 *   - github:user/repo (with `ref` field)      (tag/branch/commit-SHA)
 *   - github:user/repo#agents/foo              (monorepo package subpath)
 *   - ./relative/path or /absolute/path        (local source)
 */
function hasValidGithubSubpath(source: string): boolean {
  const hashIdx = source.indexOf('#')
  if (hashIdx === -1) return true
  if (source.indexOf('#', hashIdx + 1) !== -1) return false

  const subpath = source.slice(hashIdx + 1)
  if (subpath.length === 0) return false
  if (!/^[A-Za-z0-9._/-]+$/.test(subpath)) return false
  if (subpath.startsWith('/') || subpath.endsWith('/')) return false
  if (subpath.split('/').some((segment) => segment === '..' || segment === '.')) return false
  return true
}

function isValidSource(source: string): boolean {
  if (source.startsWith('github:')) return hasValidGithubSubpath(source)
  return (
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('/') ||
    source.startsWith('~/')
  )
}

const SourceSchema = z
  .string()
  .min(1)
  .refine(
    isValidSource,
    {
      message:
        "source must be 'github:user/repo[#subpath]' or a local path (./, ../, /, ~/)",
    },
  )

const DependencySchema = z.object({
  source: SourceSchema,
  ref: z.string().min(1),
  /** Filter to a subset of items the dependency exposes. Undefined → all. */
  items: z.array(z.string().min(1)).optional(),
  /** Optional alias if the depended-upon item collides with another at the projection target. */
  installAs: PackageIdSchema.nullable().optional(),
})

const DependenciesSchema = z
  .object({
    skills: z.array(DependencySchema).optional(),
    workflows: z.array(DependencySchema).optional(),
    lessons: z.array(DependencySchema).optional(),
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
   * Declarative MCP-tool restriction list. Missing or empty means unrestricted;
   * non-empty lists are enforced at listing and invocation time.
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
  /** Lessons that auto-enable on install. Anything here gets a lesson block injected by default. */
  enableLessons: z.array(LessonIdSchema).optional(),
})

// ─── Per-kind contributions ──────────────────────────────────────────────────

const AgentContributionsSchema = z.object({
  workspaceFiles: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  workflows: z.array(z.string().min(1)).optional(),
  workflowSkills: z.array(z.string().min(1)).optional(),
  lessons: z.array(z.string().min(1)).optional(),
  assets: z.array(z.string().min(1)).optional(),
  /** Team persona seed → {contentDir}/team/personas/{agentId}.md. Seeded only when missing — personas are user territory, never overwritten or reclaimed. */
  persona: z.string().min(1).optional(),
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

const LessonPackContributionsSchema = z.object({
  lessons: z.array(z.string().min(1)).min(1, {
    message: 'lesson-pack must contribute at least one lesson file',
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
  /** Required runtime secrets by env-var name. Secret values are never stored in packages. */
  secrets: z.array(SecretDeclarationSchema).optional(),
}

export const AgentManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('agent'),
  agent: AgentStanzaSchema,
  install: InstallStanzaSchema,
  contributions: AgentContributionsSchema,
  dependencies: DependenciesSchema,
})

/**
 * Provenance of a pack synthesized from an external hub bundle (#687):
 * the original source ref, the upstream version/ref it resolved to, and the
 * content sha observed at fetch time. Recorded by manifest synthesis so a
 * hub skill can always answer "where did this come from" without the hub.
 */
const UpstreamSchema = z.object({
  source: z.string().min(1),
  ref: z.string().optional(),
  resolvedSha: z.string().optional(),
})

export const SkillPackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('skill-pack'),
  contributions: SkillPackContributionsSchema,
  dependencies: DependenciesSchema,
  /** Capability-pack extensions: a skill-pack that names a capability and declares what it needs. */
  capability: CapabilitySlugSchema.optional(),
  runtimes: RuntimesSchema,
  requires: RequiresSchema,
  platforms: PlatformsSchema,
  /** Hub provenance for synthesized packs (#687). */
  upstream: UpstreamSchema.optional(),
})

export const WorkflowPackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('workflow-pack'),
  contributions: WorkflowPackContributionsSchema,
  dependencies: DependenciesSchema,
})

export const LessonPackManifestSchema = z.object({
  ...BaseManifestFields,
  kind: z.literal('lesson-pack'),
  contributions: LessonPackContributionsSchema,
  dependencies: DependenciesSchema,
})

export const ManifestSchema = z.discriminatedUnion('kind', [
  AgentManifestSchema,
  SkillPackManifestSchema,
  WorkflowPackManifestSchema,
  LessonPackManifestSchema,
])

// ─── Inferred TypeScript types (the canonical surface) ───────────────────────

export type AgentManifest = z.infer<typeof AgentManifestSchema>
export type SkillPackManifest = z.infer<typeof SkillPackManifestSchema>
export type WorkflowPackManifest = z.infer<typeof WorkflowPackManifestSchema>
export type LessonPackManifest = z.infer<typeof LessonPackManifestSchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type Dependency = z.infer<typeof DependencySchema>
export type SecretDeclaration = z.infer<typeof SecretDeclarationSchema>
export type PackageKind = Manifest['kind']
export type BinRequirement = z.infer<typeof BinRequirementSchema>
export type BinDownload = z.infer<typeof BinDownloadSchema>
export type NpmRequirement = z.infer<typeof NpmRequirementSchema>
export type ModelRequirement = z.infer<typeof ModelRequirementSchema>
export type PrereqRequirement = z.infer<typeof PrereqRequirementSchema>

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
