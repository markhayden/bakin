/**
 * Git plugin — server entry point.
 * Provides worktree isolation tools for code-producing agents.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type {
  ExecToolResult,
  HealthCheckRunInput,
  PluginContext,
} from '@bakin/core/plugin-types'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { healthResourceId } from '@bakin/core/health/observation-builders'
import type { PluginContextLite } from '@bakin/core/routing'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { getContentDir } from '../../packages/core/src/content-dir'

const execFileAsync = promisify(execFile)

const REGISTRY_PATH = 'worktrees.json'
const DEFAULT_WORKTREE_DIR = 'git-worktrees'
// No default allowed root: repo access is an explicit operator decision.
// (The old hardcoded personal path silently confined fresh installs to a
// stranger's directory convention — same-agent-concurrency audit F7.)

const okResponse = z.object({ ok: z.boolean() }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()

const prepareShape = {
  repoPath: z.string().min(1),
  taskId: z.string().min(1),
  branch: z.string().min(1).optional(),
  baseRef: z.string().min(1).default('HEAD'),
  purpose: z.string().max(200).optional(),
}
const prepareSchema = z.object(prepareShape)

const statusShape = {
  repoPath: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  includeReleased: z.boolean().default(false),
}
const statusSchema = z.object(statusShape)

const statusQuerySchema = z.object({
  repoPath: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  includeReleased: z.enum(['true', 'false']).optional(),
})

const releaseShape = {
  worktreePath: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  force: z.boolean().default(false),
}
const releaseSchema = z.object(releaseShape).refine(
  (input) => Boolean(input.worktreePath) || Boolean(input.repoPath && input.taskId),
  { message: 'Provide worktreePath, or repoPath plus taskId.' },
)

const routePrepareSchema = prepareSchema.extend({
  agent: z.string().min(1).optional(),
})

const routeReleaseSchema = releaseSchema.and(z.object({
  agent: z.string().min(1).optional(),
}))

type PrepareInput = z.infer<typeof prepareSchema>
type ReleaseInput = z.infer<typeof releaseSchema>

interface WorktreeEntry {
  id: string
  repoPath: string
  worktreePath: string
  branch: string
  baseRef: string
  taskId: string
  agent: string
  purpose?: string
  state: 'active' | 'released'
  createdAt: string
  updatedAt: string
  releasedAt?: string
}

interface Registry {
  version: 1
  worktrees: WorktreeEntry[]
}

interface GitSettings {
  allowedRepoRoots?: Array<string | { path?: string }>
  worktreeRoot?: string
}

interface GitStatus {
  branch: string | null
  status: string
  dirty: boolean
}

function emptyRegistry(): Registry {
  return { version: 1, worktrees: [] }
}

function readRegistry(ctx: PluginContextLite): Registry {
  const raw = ctx.storage.read(REGISTRY_PATH)
  if (!raw) return emptyRegistry()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Git worktree registry is invalid JSON at ${REGISTRY_PATH}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (
    !parsed
    || typeof parsed !== 'object'
    || (parsed as Registry).version !== 1
    || !Array.isArray((parsed as Registry).worktrees)
  ) {
    throw new Error(`Git worktree registry has an unsupported shape at ${REGISTRY_PATH}`)
  }

  return parsed as Registry
}

function writeRegistry(ctx: PluginContextLite, registry: Registry): void {
  ctx.storage.write(REGISTRY_PATH, JSON.stringify(registry, null, 2))
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function resolvePath(path: string): string {
  return resolve(expandHome(path))
}

function realpath(path: string): string {
  return realpathSync(resolvePath(path))
}

function normalizeAgent(agent: string): string {
  return slug(agent || 'agent') || 'agent'
}

function slug(value: string, max = 48): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, max).replace(/-$/, '')
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function isWithin(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function readSettings(ctx: PluginContextLite): { allowedRepoRoots: string[]; worktreeRoot: string } {
  const raw = ctx.getSettings<GitSettings>()
  const settingsRoots = Array.isArray(raw.allowedRepoRoots)
    ? raw.allowedRepoRoots
        .map((entry) => typeof entry === 'string' ? entry : entry.path)
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

  // Empty = nothing bindable/preparable until the operator configures roots.
  const allowedRepoRoots = settingsRoots
  return {
    allowedRepoRoots,
    worktreeRoot: raw.worktreeRoot && raw.worktreeRoot.trim()
      ? raw.worktreeRoot
      : join(getContentDir(), DEFAULT_WORKTREE_DIR),
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
    return String(result.stdout).trim()
  } catch (err) {
    const maybe = err as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string }
    const stderr = maybe.stderr ? String(maybe.stderr).trim() : ''
    const stdout = maybe.stdout ? String(maybe.stdout).trim() : ''
    const message = stderr || stdout || maybe.message || String(err)
    throw new Error(message)
  }
}

async function tryGit(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    return { ok: true, stdout: await runGit(cwd, args) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function assertSafeRef(value: string, label: string): void {
  if (value.length > 200) throw new Error(`${label} is too long`)
  if (value.startsWith('-')) throw new Error(`${label} must not start with "-"`)
  if (/[\u0000-\u001f\s]/.test(value)) throw new Error(`${label} must not contain whitespace or control characters`)
  if (value.includes('..') || value.includes('@{')) throw new Error(`${label} contains unsupported git ref syntax`)
}

async function validateBranch(repoPath: string, branch: string): Promise<void> {
  assertSafeRef(branch, 'branch')
  const result = await tryGit(repoPath, ['check-ref-format', '--branch', branch])
  if (!result.ok) {
    throw new Error(`Invalid branch "${branch}": ${result.error}`)
  }
}

function validateBaseRef(baseRef: string): void {
  assertSafeRef(baseRef, 'baseRef')
}

async function resolveRepoRoot(ctx: PluginContextLite, repoPath: string): Promise<string> {
  let candidate: string
  try {
    candidate = realpath(repoPath)
  } catch {
    throw new Error(`Repository path does not exist: ${repoPath}`)
  }

  const settings = readSettings(ctx)
  const allowedRoots = settings.allowedRepoRoots.map((root) => {
    try {
      return realpath(root)
    } catch {
      return resolvePath(root)
    }
  })

  if (!allowedRoots.some((root) => isWithin(candidate, root))) {
    throw new Error(`Repository path is outside configured allowed repo roots: ${settings.allowedRepoRoots.join(', ')}`)
  }

  const topLevel = await runGit(candidate, ['rev-parse', '--show-toplevel'])
  const repoRoot = realpath(topLevel)
  if (!allowedRoots.some((root) => isWithin(repoRoot, root))) {
    throw new Error(`Git repository root is outside configured allowed repo roots: ${settings.allowedRepoRoots.join(', ')}`)
  }
  return repoRoot
}

function buildBranch(input: PrepareInput, agent: string): string {
  // `bakin/run/*` is the DISPATCH-managed worktree namespace (branch-per-run,
  // doctor-advisory-counted) — agent-driven prepares must not mint names
  // there or the two systems' bookkeeping cross-matches.
  if (input.branch?.startsWith('bakin/run/')) {
    throw new Error("Branch names under 'bakin/run/' are reserved for dispatch-managed run worktrees")
  }
  if (input.branch) return input.branch
  const task = slug(input.taskId) || 'task'
  return `bakin/${task}-${normalizeAgent(agent)}`
}

function buildWorktreePath(ctx: PluginContextLite, repoPath: string, input: PrepareInput, agent: string, branch: string): string {
  const settings = readSettings(ctx)
  const root = resolvePath(settings.worktreeRoot)
  const repoPart = `${slug(basename(repoPath)) || 'repo'}-${shortHash(repoPath)}`
  const taskPart = `${slug(input.taskId) || 'task'}-${normalizeAgent(agent)}-${shortHash(branch)}`
  return join(root, repoPart, taskPart)
}

function registryId(repoPath: string, taskId: string, agent: string, branch: string): string {
  return shortHash([repoPath, taskId, agent, branch].join('\0'))
}

function findActiveForTask(
  registry: Registry,
  repoPath: string,
  taskId: string,
  agent: string,
): WorktreeEntry | undefined {
  return registry.worktrees.find((entry) =>
    entry.state === 'active'
    && entry.repoPath === repoPath
    && entry.taskId === taskId
    && entry.agent === agent
  )
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await tryGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
  return result.ok
}

async function readGitStatus(entry: WorktreeEntry): Promise<GitStatus> {
  const output = await runGit(entry.worktreePath, ['status', '--short', '--branch'])
  const lines = output.split('\n').filter(Boolean)
  const branchLine = lines.find((line) => line.startsWith('## '))
  return {
    branch: branchLine ? branchLine.slice(3) : null,
    status: output,
    dirty: lines.some((line) => !line.startsWith('## ')),
  }
}

function publicEntry(entry: WorktreeEntry, status?: GitStatus | { error: string }): Record<string, unknown> {
  const statusError = status && 'error' in status ? status.error : undefined
  const gitStatus = status && !('error' in status) ? status : undefined
  return {
    id: entry.id,
    repoPath: entry.repoPath,
    worktreePath: entry.worktreePath,
    branch: entry.branch,
    baseRef: entry.baseRef,
    taskId: entry.taskId,
    agent: entry.agent,
    purpose: entry.purpose,
    state: entry.state,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    releasedAt: entry.releasedAt,
    exists: existsSync(entry.worktreePath),
    dirty: gitStatus?.dirty ?? false,
    status: gitStatus?.status ?? '',
    statusError,
  }
}

function parseParams<T>(schema: z.ZodType<T>, params: Record<string, unknown>): T {
  const result = schema.safeParse(params)
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '))
  }
  return result.data
}

async function prepareWorktree(
  ctx: PluginContextLite,
  raw: Record<string, unknown>,
  agent: string,
): Promise<ExecToolResult> {
  try {
    const input = parseParams(prepareSchema, raw)
    const repoPath = await resolveRepoRoot(ctx, input.repoPath)
    const branch = buildBranch(input, agent)
    validateBaseRef(input.baseRef)
    await validateBranch(repoPath, branch)

    const registry = readRegistry(ctx)
    const existing = findActiveForTask(registry, repoPath, input.taskId, agent)
    if (existing) {
      if (existing.branch !== branch) {
        return {
          ok: false,
          error: `Task ${input.taskId} already has active worktree ${existing.worktreePath} on branch ${existing.branch}. Release it before creating ${branch}.`,
        }
      }
      if (!existsSync(existing.worktreePath)) {
        return {
          ok: false,
          error: `Tracked worktree is missing from disk: ${existing.worktreePath}. Run release with force=true to clear the stale registry entry.`,
        }
      }
      const status = await readGitStatus(existing).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
      return {
        ok: true,
        reused: true,
        ...publicEntry(existing, status),
        nextSteps: [`cd ${existing.worktreePath}`],
      }
    }

    const worktreePath = buildWorktreePath(ctx, repoPath, input, agent, branch)
    if (existsSync(worktreePath)) {
      return {
        ok: false,
        error: `Worktree path already exists but is not tracked as active: ${worktreePath}`,
      }
    }

    mkdirSync(dirname(worktreePath), { recursive: true })
    const exists = await branchExists(repoPath, branch)
    const args = exists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath, input.baseRef]
    await runGit(repoPath, args)

    const now = new Date().toISOString()
    const entry: WorktreeEntry = {
      id: registryId(repoPath, input.taskId, agent, branch),
      repoPath,
      worktreePath,
      branch,
      baseRef: input.baseRef,
      taskId: input.taskId,
      agent,
      purpose: input.purpose,
      state: 'active',
      createdAt: now,
      updatedAt: now,
    }
    registry.worktrees.push(entry)
    writeRegistry(ctx, registry)

    ctx.activity.log(agent, `Prepared git worktree for task ${input.taskId}`, { taskId: input.taskId, category: 'git' })
    const status = await readGitStatus(entry).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
    return {
      ok: true,
      reused: false,
      ...publicEntry(entry, status),
      nextSteps: [`cd ${worktreePath}`],
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function listWorktrees(
  ctx: PluginContextLite,
  raw: Record<string, unknown>,
): Promise<ExecToolResult> {
  try {
    const input = parseParams(statusSchema, raw)
    const repoPath = input.repoPath ? await resolveRepoRoot(ctx, input.repoPath) : undefined
    const registry = readRegistry(ctx)
    const entries = registry.worktrees.filter((entry) => {
      if (!input.includeReleased && entry.state === 'released') return false
      if (repoPath && entry.repoPath !== repoPath) return false
      if (input.taskId && entry.taskId !== input.taskId) return false
      return true
    })

    const worktrees: Record<string, unknown>[] = []
    for (const entry of entries) {
      const status = existsSync(entry.worktreePath)
        ? await readGitStatus(entry).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }))
        : { error: 'worktree path is missing from disk' }
      worktrees.push(publicEntry(entry, status))
    }

    return { ok: true, worktrees }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function findReleaseTarget(
  registry: Registry,
  input: ReleaseInput,
  repoPath: string | undefined,
): WorktreeEntry | undefined {
  if (input.worktreePath) {
    const target = resolvePath(input.worktreePath)
    return registry.worktrees.find((entry) => entry.state === 'active' && resolvePath(entry.worktreePath) === target)
  }
  return registry.worktrees.find((entry) =>
    entry.state === 'active'
    && entry.repoPath === repoPath
    && entry.taskId === input.taskId
  )
}

async function releaseWorktree(
  ctx: PluginContextLite,
  raw: Record<string, unknown>,
  agent: string,
): Promise<ExecToolResult> {
  try {
    const input = parseParams(releaseSchema, raw)
    const repoPath = input.repoPath ? await resolveRepoRoot(ctx, input.repoPath) : undefined
    const registry = readRegistry(ctx)
    const entry = findReleaseTarget(registry, input, repoPath)
    if (!entry) {
      return { ok: false, error: 'No active tracked worktree matched the release request.' }
    }

    if (!existsSync(entry.worktreePath)) {
      if (!input.force) {
        return {
          ok: false,
          error: `Tracked worktree is missing from disk: ${entry.worktreePath}. Re-run with force=true to mark it released.`,
        }
      }
    } else {
      const status = await readGitStatus(entry)
      if (status.dirty && !input.force) {
        return {
          ok: false,
          error: `Worktree is dirty; commit, stash, or re-run with force=true before release. Path: ${entry.worktreePath}`,
          status: status.status,
        }
      }
      const args = input.force
        ? ['worktree', 'remove', '--force', entry.worktreePath]
        : ['worktree', 'remove', entry.worktreePath]
      await runGit(entry.repoPath, args)
    }

    const now = new Date().toISOString()
    entry.state = 'released'
    entry.updatedAt = now
    entry.releasedAt = now
    writeRegistry(ctx, registry)
    ctx.activity.log(agent, `Released git worktree for task ${entry.taskId}`, { taskId: entry.taskId, category: 'git' })
    return { ok: true, ...publicEntry(entry) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkWorktrees(ctx: PluginContextLite): Promise<HealthCheckRunInput> {
  try {
    const registry = readRegistry(ctx)
    const active = registry.worktrees.filter((entry) => entry.state === 'active')
    if (active.length === 0) {
      return healthObserved([healthHealthy({ key: 'registry', summary: 'No active git worktrees are tracked.' })])
    }

    const missing = active.filter((entry) => !existsSync(entry.worktreePath))
    if (missing.length > 0) {
      return healthObserved(missing.map((entry) => healthWarning({
        key: `missing.${entry.id}`,
        summary: `The worktree for task ${entry.taskId} is missing.`,
        evidence: { worktreePath: entry.worktreePath },
        incident: {
          key: `missing.${entry.id}`,
          title: 'A tracked Git worktree is missing',
          impact: `Task ${entry.taskId} may no longer have its isolated working directory.`,
          disposition: 'action_required',
          // Resource ids must satisfy the contract's stable-key format — a
          // raw path here failed validation and hid this REAL finding
          // behind a generic Verify card for three releases (2026-07-23).
          resources: [
            { kind: 'task', id: healthResourceId(entry.taskId), label: entry.taskId.slice(0, 120) },
            { kind: 'directory', id: healthResourceId(entry.worktreePath), label: entry.worktreePath.slice(0, 120) },
          ],
          resolution: { key: 'release-worktree', type: 'instructions', label: 'Review worktree', steps: ['Confirm the task no longer needs this worktree, then release its stale registry entry with the Git release tool.'] },
        },
      })) as [ReturnType<typeof healthWarning>, ...ReturnType<typeof healthWarning>[]])
    }

    return healthObserved([healthHealthy({
      key: 'registry',
      summary: `${active.length} active git worktree${active.length === 1 ? '' : 's'} tracked.`,
      evidence: { active: active.length },
    })])
  } catch (err) {
    return healthObserved([healthWarning({
      key: 'registry-read',
      summary: 'The Git worktree registry could not be read.',
      detail: err instanceof Error ? err.message : String(err),
      incident: {
        key: 'registry-unreadable', title: 'Git worktree state could not be verified',
        impact: 'Bakin cannot confirm whether task worktrees are present and clean.', disposition: 'watch',
        resources: [{ kind: 'file', id: REGISTRY_PATH, label: 'Git worktree registry' }],
        resolution: { key: 'retry', type: 'rerun', label: 'Check again' },
      },
    })])
  }
}

const routes = [
  defineRoute({
    path: '/worktrees',
    method: 'GET',
    summary: 'List tracked git worktrees',
    query: statusQuerySchema,
    responses: { 200: okResponse, 400: errorResponse },
    handler: async (_req, ctx, { query }) => {
      const result = await listWorktrees(ctx, {
        repoPath: query.repoPath,
        taskId: query.taskId,
        includeReleased: query.includeReleased === 'true',
      })
      return Response.json(result, { status: result.ok ? 200 : 400 })
    },
  }),
  defineRoute({
    path: '/worktrees/prepare',
    method: 'POST',
    summary: 'Create or reuse an isolated git worktree for a task',
    body: routePrepareSchema,
    responses: { 200: okResponse, 400: errorResponse },
    handler: async (_req, ctx, { body }) => {
      const { agent, ...input } = body
      const result = await prepareWorktree(ctx, input, agent || 'rest')
      return Response.json(result, { status: result.ok ? 200 : 400 })
    },
  }),
  defineRoute({
    path: '/worktrees/release',
    method: 'POST',
    summary: 'Release a tracked git worktree',
    body: routeReleaseSchema,
    responses: { 200: okResponse, 400: errorResponse },
    handler: async (_req, ctx, { body }) => {
      const input = body as z.infer<typeof routeReleaseSchema>
      const { agent, ...release } = input
      const result = await releaseWorktree(ctx, release, agent || 'rest')
      return Response.json(result, { status: result.ok ? 200 : 400 })
    },
  }),
]

const gitPlugin = definePlugin({
  id: 'git',
  name: 'Git',
  version: '1.0.0',
  routes,
  settingsSchema: {
    fields: [
      {
        key: 'allowedRepoRoots',
        label: 'Allowed repo roots',
        description: 'Directories agents may prepare git worktrees from (also gates dispatch repo binding). Empty = disabled until configured.',
        type: 'list',
        default: [],
        addLabel: 'Add repo root',
        uniqueField: 'path',
        itemShape: {
          path: {
            key: 'path',
            label: 'Path',
            type: 'string',
            required: true,
          },
        },
      },
      {
        key: 'worktreeRoot',
        label: 'Worktree root',
        description: 'Directory where Bakin-created worktrees are stored.',
        type: 'string',
        default: `~/.bakin/${DEFAULT_WORKTREE_DIR}`,
      },
    ],
  },
  activate(ctx: PluginContext) {
    ctx.registerExecTool({
      name: 'bakin_exec_git_prepare_worktree',
      description: 'Create or reuse an isolated git worktree for a task. Call this before editing code for a Bakin task.',
      label: 'Prepared git worktree',
      activityDuplicate: true,
      parameters: prepareShape,
      handler: (params, agent) => prepareWorktree(ctx, params, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_git_status',
      description: 'List Bakin-tracked git worktrees and their dirty state.',
      label: 'Checked git worktrees',
      parameters: statusShape,
      handler: (params) => listWorktrees(ctx, params),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_git_release_worktree',
      description: 'Release a tracked git worktree. Refuses dirty removal unless force=true.',
      label: 'Released git worktree',
      activityDuplicate: true,
      parameters: releaseShape,
      handler: (params, agent) => releaseWorktree(ctx, params, agent),
    })
    ctx.registerHealthCheck({
      id: 'worktrees',
      name: 'Git worktree registry',
      description: 'Checks that active task worktrees still exist and the registry is readable.',
      group: { key: 'git', label: 'Git' },
      run: () => checkWorktrees(ctx),
    })
  },
})

export default gitPlugin
