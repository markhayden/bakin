import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import yaml from 'js-yaml'
import type { WorkflowDefinition, WorkflowStep } from '@bakin/workflows/types'

const ROOT = process.cwd()
const SCAN_ROOTS = [
  'src',
  'plugins',
  'packages/core/src',
  'packages/host/src',
  'packages/sdk/src',
  'cli',
  'scripts',
  'server.ts',
]
const EXT_RE = /\.(ts|tsx|mjs|mts|js|jsx|cjs|json|ya?ml)$/
const WORKFLOW_DEFAULTS_RE = /(^|\/)plugins\/[^/]+\/defaults\/workflows\/[^/]+\.ya?ml$/

// The disposable OpenClaw Docker dev rig (scripts/instance*) is, by definition,
// OpenClaw-specific orchestration: it speaks the OpenClaw CLI, mounts the
// OpenClaw home, and drives Docker. It sits AT the adapter layer (never ships
// in the binary, can never be runtime-agnostic), so the three provider-boundary
// rules below exempt it. All other rules (antfly/sqlite/flow_runs/discord
// endpoints) still apply to keep the rig honest.
const isOpenClawDevRig = (rel: string) =>
  rel === 'scripts/instance.ts' || rel.startsWith('scripts/instance/')

const DENYLIST = [
  {
    label: 'concrete adapter import outside adapter factories',
    regex: /@bakin\/adapter-(?:antfly|openclaw|pi)/,
    allow: (rel: string) => rel === 'src/core/search-adapter-factory.ts' || rel === 'src/core/runtime-adapter-factory.ts',
  },
  {
    label: 'raw Pi home/path/SDK access outside adapter-pi',
    // Same treatment OpenClaw gets: Pi's home dir, env override, path
    // helpers, and the Pi SDK package must never leak upstream — a second
    // (third) runtime must require zero changes above the factory.
    regex: /(?:~\/\.pi\b|PI_HOME|getPiHome|getPiPath|@earendil-works)/,
  },
  {
    label: 'legacy core Antfly facade import',
    regex: /(?:@\/core\/antfly|src\/core\/antfly|core\/antfly-server|antfly-server)/,
  },
  {
    label: 'raw Antfly SDK outside adapter-antfly',
    regex: /@antfly\/sdk/,
  },
  {
    label: 'raw OpenClaw home/path access outside adapter-openclaw',
    regex: /(?:~\/\.openclaw|OPENCLAW_HOME|getOpenClawHome|getOpenClawPath)/,
    allow: (rel: string) => rel === 'scripts/bin/check-home-bypasses.mjs' || isOpenClawDevRig(rel),
  },
  {
    label: 'legacy OpenClaw implementation module',
    regex: /(?:openclaw-home|openclaw-config|openclaw-client|discord-gateway)/,
    allow: (rel: string) => isOpenClawDevRig(rel),
  },
  {
    label: 'legacy flow_runs task metadata',
    regex: /flow_runs/,
  },
  {
    label: 'task metadata access through plugin hooks',
    regex: /tasks\.(?:readTaskboard|addTaskLog|updateTask|moveTask|blockTask|createTask|setDependency|clearDependency|deleteTask)/,
  },
  {
    label: 'antfly-specific identifier upstream of the adapter (D17: antfly is the DEFAULT search adapter, not the design)',
    // Engine/model names must not leak into core, SDK, src, or plugin code —
    // a second search adapter must require zero changes upstream of the
    // factory. Comments count: they rot into load-bearing assumptions.
    regex: /(?:antflydb\/|clipclap|bge-small|mxbai-rerank|releases\.antfly\.io|antfly\s+swarm)/i,
    allow: (rel: string) =>
      rel === 'src/core/search-adapter-factory.ts'
      // Settings surfaces carry the ADAPTER'S OWN defaults/keys for
      // ~/.bakin/settings.json — the values are adapter-owned data, not
      // upstream logic. Everything else must speak capabilities only.
      || rel === 'src/core/settings.ts'
      || rel === 'packages/core/src/settings.ts'
      || rel.startsWith('src/core/onboarding/')
      // Engine-specific dev tooling (same footing as the OpenClaw rig):
      // the chaos drills deliberately drive a real antfly binary.
      || rel === 'scripts/dev/search-chaos-drills.ts',
  },
  {
    label: 'raw SQLite access outside adapter packages',
    regex: /(?:bun:sqlite|new\s+Database\b|Database\()/,
    // The shared storage core is the SOLE bun:sqlite importer — domain
    // modules (execution ledger, future non-file stores) consume its
    // opaque Db handle and never touch sqlite directly.
    allow: (rel: string) => rel === 'packages/core/src/storage/db.ts',
  },
  {
    label: 'raw OpenClaw CLI command outside runtime adapter',
    regex: /openclaw\s+(?:cron|flows|agent|config)\b/,
    allow: (rel: string) => isOpenClawDevRig(rel),
  },
  {
    label: 'raw Discord provider endpoint outside runtime adapter',
    regex: /(?:discord(?:app)?\.com|discord\.gg|discord\/api)/,
  },
  {
    label: 'raw runtime config access outside allowlisted gate',
    regex: /(?:config\.raw|\.raw<)/,
    allow: (rel: string) => rel === 'src/core/runtime-config-raw.ts',
  },
  {
    // Whole-config reads/replaces are scope-typed + mutation-audited via the
    // governed wrapper; direct adapter calls bypass that (the audit's
    // config-surface finding). update(patch) no longer exists at all.
    label: 'whole runtime-config access outside the governed wrapper',
    regex: /\.config\.(?:get|replace|update)\s*(?:<[^>]*>)?\s*\(/,
    allow: (rel: string) => rel === 'src/core/runtime-config.ts',
  },
  {
    label: 'provider setup URL outside adapter factory',
    regex: /(?:openclaw\.ai|pi\.dev)/,
    allow: (rel: string) => rel === 'src/core/runtime-adapter-factory.ts',
  },
]

function walk(path: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const full = join(path, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (entry.isFile() && EXT_RE.test(entry.name)) {
      out.push(full)
    }
  }

  return out
}

function scanFiles(): string[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root)
    if (EXT_RE.test(root)) files.push(abs)
    else walk(abs, files)
  }
  return files
}

function isSymbolicAgent(value: string): boolean {
  return value.startsWith('$')
}

// ─── Content transport-neutrality (P1.7) ─────────────────────────────────────
//
// Shipped agent-facing CONTENT must never hardcode a transport: HOW an agent
// invokes Bakin's tools is rendered per-runtime into the injected tool-access
// section, and runtime-private URI schemes (media://) don't exist on every
// runtime. Ban them so a switch (Pi↔OpenClaw) never leaves stale wording.
const CONTENT_EXT_RE = /\.(md|ya?ml|ts|tsx|json)$/
const CONTENT_FILE_ROOTS = ['skill/SKILL.md', 'src/core/team-context-defaults.ts']

const TRANSPORT_BANS: Array<{ re: RegExp; label: string }> = [
  { re: /mcporter/i, label: 'mcporter (removed transport CLI)' },
  { re: /media:\/\//, label: 'raw media:// URI (runtime-private scheme)' },
  { re: /bakin-<agent>/, label: 'bakin-<agent> (per-agent MCP server template)' },
  { re: /bakin-[a-z][\w-]*\.bakin_exec/, label: 'per-agent MCP server prefix (bakin-<name>.bakin_exec_*)' },
  // CLI flag syntax is transport, not tool contract: `--args`/`--timeout` were
  // mcporter invocation flags — meaningless for in-process/native-MCP calls.
  { re: /--args\b/, label: '--args flag (mcporter CLI invocation syntax)' },
  { re: /--timeout\s+\d/, label: '--timeout flag (mcporter CLI invocation syntax)' },
]

function walkContent(path: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const full = join(path, entry.name)
    if (entry.isDirectory()) walkContent(full, out)
    else if (entry.isFile() && CONTENT_EXT_RE.test(entry.name)) out.push(full)
  }
  return out
}

function scanContentFiles(): string[] {
  const files = CONTENT_FILE_ROOTS.map((r) => join(ROOT, r))
  const pluginsDir = join(ROOT, 'plugins')
  try {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkContent(join(pluginsDir, entry.name, 'defaults'), files)
    }
  } catch {
    // no plugins dir — nothing to scan
  }
  return files
}

/** Transport-string violations in one shipped-content file. */
export function findTransportViolations(rel: string, content: string): string[] {
  const hits: string[] = []
  for (const { re, label } of TRANSPORT_BANS) {
    if (re.test(content)) hits.push(`${rel}: ${label}`)
  }
  return hits
}

function childSteps(step: WorkflowStep): WorkflowStep[] {
  if (step.type === 'parallel') return step.steps
  return []
}

function collectWorkflowAgentViolations(
  def: WorkflowDefinition,
  rel: string,
  pathPrefix = 'steps',
): string[] {
  const hits: string[] = []

  function visit(step: WorkflowStep, path: string): void {
    const maybeAgent = 'agent' in step ? step.agent : undefined
    if (typeof maybeAgent === 'string' && !isSymbolicAgent(maybeAgent)) {
      hits.push(`${rel}:${path}.agent hard-coded runtime agent "${maybeAgent}"; use "$assigned" or another symbolic token`)
    }

    for (const [idx, child] of childSteps(step).entries()) {
      visit(child, `${path}.steps[${idx}]`)
    }
  }

  def.steps.forEach((step, idx) => visit(step, `${pathPrefix}[${idx}]`))
  return hits
}

describe('adapter boundary architecture', () => {
  it('keeps provider internals inside adapter packages', () => {
    const hits: string[] = []

    for (const file of scanFiles()) {
      const rel = relative(ROOT, file)
      const lines = readFileSync(file, 'utf-8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const rule of DENYLIST) {
          if (rule.regex.test(line) && !rule.allow?.(rel)) {
            hits.push(`${rel}:${i + 1} ${rule.label}: ${line.trim()}`)
          }
        }
      }
    }

    expect(hits).toEqual([])
  })

  it('flags hard-coded agents in workflow definitions', () => {
    const def = {
      name: 'Bad Default',
      version: 1,
      steps: [
        { id: 'write', type: 'agent', label: 'Write', agent: 'chef' },
        { id: 'publish', type: 'output', label: 'Publish', agent: '$assigned' },
      ],
    } as WorkflowDefinition

    expect(collectWorkflowAgentViolations(def, 'plugins/example/defaults/workflows/bad.yaml')).toEqual([
      'plugins/example/defaults/workflows/bad.yaml:steps[0].agent hard-coded runtime agent "chef"; use "$assigned" or another symbolic token',
    ])
  })

  it('keeps shipped workflow defaults portable across runtime rosters', () => {
    const hits: string[] = []

    for (const file of scanFiles()) {
      const rel = relative(ROOT, file)
      if (!WORKFLOW_DEFAULTS_RE.test(rel)) continue

      const parsed = yaml.load(readFileSync(file, 'utf-8')) as WorkflowDefinition
      hits.push(...collectWorkflowAgentViolations(parsed, rel))
    }

    expect(hits).toEqual([])
  })

  it('keeps shipped agent-facing content transport-neutral', () => {
    const hits: string[] = []
    for (const file of scanContentFiles()) {
      let content: string
      try {
        content = readFileSync(file, 'utf-8')
      } catch {
        continue
      }
      hits.push(...findTransportViolations(relative(ROOT, file), content))
    }
    expect(hits).toEqual([])
  })

  it('the transport-neutrality check catches violations (fixture)', () => {
    expect(findTransportViolations('x.md', 'run `mcporter call bakin-main.bakin_exec_tasks_get`')).toEqual([
      'x.md: mcporter (removed transport CLI)',
      'x.md: per-agent MCP server prefix (bakin-<name>.bakin_exec_*)',
    ])
    expect(findTransportViolations('y.md', 'pass a media://inbound/x.png reference')).toEqual([
      'y.md: raw media:// URI (runtime-private scheme)',
    ])
    expect(findTransportViolations('w.md', "tool --args '{\"a\":1}' with --timeout 600000")).toEqual([
      'w.md: --args flag (mcporter CLI invocation syntax)',
      'w.md: --timeout flag (mcporter CLI invocation syntax)',
    ])
    expect(findTransportViolations('z.md', 'call `bakin_exec_tasks_get taskId=<id>` directly')).toEqual([])
  })
})
