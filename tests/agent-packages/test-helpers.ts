/**
 * Shared test helpers for the agent-packages feature.
 *
 * Every test in `tests/agent-packages/` mocks both `content-dir` and
 * `openclaw-home` to temp directories — the mandatory CC-6 isolation rule.
 * `mockBakinAndOpenClawHomes()` returns those temp paths plus a cleanup hook;
 * subsequent helpers (seeding agents, asserting projections, scanning for
 * leakage) operate on those paths.
 *
 * Usage shape:
 *
 *   const { bakinDir, openClawDir, cleanup } = mockBakinAndOpenClawHomes()
 *   afterAll(cleanup)
 *
 *   seedOpenClawAgent(openClawDir, { id: 'pixel', identity: { name: 'Pixel' } })
 *   ...
 *   assertNoLeakage(bakinDir, openClawDir)
 *
 * The mocks themselves cannot be installed by this helper — `mock.module()`
 * has to run at the top of the test file BEFORE any agent-packages module is
 * imported. So callers always do the mocks inline; the helper only manages
 * the temp dirs and the structured fixtures.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import {
  computeFileSha,
  type InstalledByMarker,
  installedByPath,
} from '../../packages/core/src/agent-packages/markers'

// ─── Temp homes ──────────────────────────────────────────────────────────────

export interface IsolatedHomes {
  bakinDir: string
  openClawDir: string
  cleanup: () => void
}

/**
 * Allocate temp directories for `~/.bakin/` and `~/.openclaw/` and return
 * paths + a cleanup function. Call `mock.module(...)` at the top of the test
 * file to redirect the modules — this helper only owns the directories.
 *
 * The temp paths embed a random UUID so two test files running in parallel
 * (bun's --isolate worker model) cannot collide.
 */
export function mockBakinAndOpenClawHomes(scope = 'agent-pkg'): IsolatedHomes {
  const stamp = `${scope}-${Date.now()}-${randomUUID()}`
  const bakinDir = join(tmpdir(), `bakin-${stamp}`)
  const openClawDir = join(tmpdir(), `openclaw-${stamp}`)
  mkdirSync(bakinDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  return {
    bakinDir,
    openClawDir,
    cleanup: () => {
      rmSync(bakinDir, { recursive: true, force: true })
      rmSync(openClawDir, { recursive: true, force: true })
    },
  }
}

// ─── OpenClaw seeding ────────────────────────────────────────────────────────

export interface SeedAgentInput {
  id: string
  identity?: { name?: string; emoji?: string }
  workspaceFiles?: Record<string, string>
  /** Defaults to `<openClawDir>/workspaces/<id>` for non-main agents. */
  workspace?: string
  /** When true (or when id === 'main'), workspace becomes <openClawDir>/workspace */
  isMain?: boolean
  /** Subagents this agent is allowed to dispatch to. */
  allowAgents?: string[]
  /** Primary model — written into openclaw.json. */
  model?: string
}

interface OpenClawAgentEntry {
  id: string
  identity?: { name?: string; emoji?: string }
  workspace?: string
  model?: { primary?: string }
  subagents?: { allowAgents?: string[] }
}

interface OpenClawConfigShape {
  agents?: {
    list?: OpenClawAgentEntry[]
    defaults?: { model?: { primary?: string }; workspace?: string }
  }
}

/**
 * Pre-seed a runtime agent into the temp OpenClaw adapter home — writes both
 * the adapter roster entry and the workspace dir + workspace files.
 * Idempotent on the roster (same id → entry replaced).
 */
export function seedOpenClawAgent(openClawDir: string, input: SeedAgentInput): void {
  const isMain = input.isMain || input.id === 'main'
  const workspace = input.workspace
    ?? (isMain
      ? join(openClawDir, 'workspace')
      : join(openClawDir, 'workspaces', input.id))

  // Write workspace files
  mkdirSync(workspace, { recursive: true })
  for (const [name, contents] of Object.entries(input.workspaceFiles ?? {})) {
    writeFileSync(join(workspace, name), contents, 'utf-8')
  }

  // Update openclaw.json roster
  const configPath = join(openClawDir, 'openclaw.json')
  const config: OpenClawConfigShape = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : {}

  if (!config.agents) config.agents = {}
  if (!config.agents.list) config.agents.list = []

  const entry: OpenClawAgentEntry = {
    id: input.id,
    ...(input.identity ? { identity: input.identity } : {}),
    ...(isMain ? {} : { workspace }),
    ...(input.model ? { model: { primary: input.model } } : {}),
    ...(input.allowAgents ? { subagents: { allowAgents: input.allowAgents } } : {}),
  }

  const idx = config.agents.list.findIndex((a) => a.id === input.id)
  if (idx === -1) {
    config.agents.list.push(entry)
  } else {
    config.agents.list[idx] = entry
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/** Read the seeded openclaw.json (typed as the shape this helper writes). */
export function readSeededOpenClawConfig(openClawDir: string): OpenClawConfigShape {
  const configPath = join(openClawDir, 'openclaw.json')
  if (!existsSync(configPath)) return {}
  return JSON.parse(readFileSync(configPath, 'utf-8')) as OpenClawConfigShape
}

// ─── Fixture manifest installation ───────────────────────────────────────────

export interface FixtureManifestInput {
  /** Path to a fixture manifest JSON in tests/fixtures/agent-packages/manifests/. */
  fixturePath: string
  /** Where to write the package source tree. Defaults to a fresh tmp dir. */
  destDir?: string
  /** Additional files to write under destDir (e.g. workspace/SOUL.md). */
  extraFiles?: Record<string, string>
}

/**
 * Materialize a fixture manifest into a real directory the installer can
 * operate on. Copies the JSON to `<destDir>/bakin-package.json` and writes any
 * `extraFiles` so `manifest.contributions.*` paths resolve.
 *
 * Returns the package directory (which is what `bakin agents install <path>`
 * accepts).
 */
export function installFixtureManifest(input: FixtureManifestInput): string {
  const destDir = input.destDir ?? join(tmpdir(), `pkg-fixture-${randomUUID()}`)
  mkdirSync(destDir, { recursive: true })

  const manifest = readFileSync(input.fixturePath, 'utf-8')
  writeFileSync(join(destDir, 'bakin-package.json'), manifest, 'utf-8')

  for (const [relPath, contents] of Object.entries(input.extraFiles ?? {})) {
    const target = join(destDir, relPath)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, contents, 'utf-8')
  }

  return destDir
}

// ─── Projection assertions ───────────────────────────────────────────────────

export interface ProjectionExpectation {
  /** Absolute path of the expected projected file or directory. */
  target: string
  /** Expected sha256 — for files, content hash; for dirs, Merkle root. */
  expectedSha?: string
  /** When true, also assert the .installedBy sidecar exists + is parseable. */
  requireSidecar?: boolean
}

/**
 * Assert that a projected file/directory exists with the expected sha (when
 * provided) and a valid `.installedBy` sidecar (when requested). Throws an
 * Error with a descriptive message on any failure — use inside test bodies
 * with `expect(() => assertProjectionExists(...)).not.toThrow()`.
 */
export function assertProjectionExists(spec: ProjectionExpectation): void {
  if (!existsSync(spec.target)) {
    throw new Error(`Projection target missing: ${spec.target}`)
  }

  if (spec.expectedSha !== undefined) {
    const isDir = statSync(spec.target).isDirectory()
    const actual = isDir ? merkleHashDir(spec.target) : computeFileSha(spec.target)
    if (actual !== spec.expectedSha) {
      throw new Error(
        `sha256 mismatch at ${spec.target}: expected ${spec.expectedSha}, got ${actual}`,
      )
    }
  }

  if (spec.requireSidecar) {
    const path = installedByPath(spec.target)
    if (!existsSync(path)) {
      throw new Error(`Sidecar missing: ${path}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      throw new Error(`Sidecar is not valid JSON: ${path}`)
    }
    const m = parsed as Partial<InstalledByMarker>
    if (!m.package || !m.sha256) {
      throw new Error(`Sidecar missing required fields: ${path}`)
    }
  }
}

/**
 * Lightweight directory Merkle hash for the assertion path. Mirrors
 * `computeDirSha` in the markers module so callers don't need to import both.
 */
function merkleHashDir(dir: string): string {
  const lines: string[] = []
  walk(dir, dir, lines)
  return createHash('sha256').update(lines.join('')).digest('hex')
}

function walk(root: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.installedBy') && !e.name.startsWith('.userEdited'))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      walk(root, full, out)
    } else if (e.isFile()) {
      const rel = full.slice(root.length + 1)
      const sha = computeFileSha(full)
      out.push(`${rel}\n${sha}\n`)
    }
  }
}

// ─── Leakage scan ────────────────────────────────────────────────────────────

/**
 * Walk both temp dirs and assert no entry escapes them — i.e. there are no
 * symlinks pointing out, no path-traversal artifacts. Belt-and-suspenders for
 * the CC-6 isolation rule.
 *
 * Throws on any path that resolves outside the temp dirs.
 */
export function assertNoLeakage(bakinDir: string, openClawDir: string): void {
  for (const root of [bakinDir, openClawDir]) {
    if (!existsSync(root)) continue
    walkAndCheckEscape(root, root)
  }
}

function walkAndCheckEscape(root: string, dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) {
      // Symlinks could escape — refuse them outright in test fixtures.
      throw new Error(`Symlink found at ${full} — agent-package tests must not use symlinks`)
    }
    if (e.isDirectory()) {
      walkAndCheckEscape(root, full)
    }
  }
}
