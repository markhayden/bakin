#!/usr/bin/env node
// Lightweight adapter-boundary hook. CI owns the full architecture test; this
// catches the common edit-time mistakes before they land in the worktree:
// provider imports outside factories, raw provider paths, and hard-coded agent
// ids in shipped workflow defaults.

import { readFileSync } from 'fs'
import { relative } from 'path'

const ROOT = process.cwd()
const EXT_RE = /\.(ts|tsx|mjs|mts|js|jsx|cjs|json|ya?ml)$/
const WORKFLOW_DEFAULT_RE = /(^|\/)plugins\/[^/]+\/defaults\/workflows\/[^/]+\.ya?ml$/

const CODE_ROOT_RE = /^(src|plugins|packages\/core\/src|packages\/host\/src|cli|scripts)\//
const CODE_FILE_RE = /^(server\.ts)$/

const ALLOWED_FILES = new Set([
  'src/core/runtime-adapter-factory.ts',
  'src/core/search-adapter-factory.ts',
  'src/core/runtime-config-raw.ts',
  'scripts/bin/check-home-bypasses.mjs',
  // Sole sanctioned bun:sqlite importer (per-rule allow in the CI arch test;
  // the edit-time hook exempts it wholesale like the instance rig).
  'packages/core/src/storage/db.ts',
])

// The delivery bridge (#669) is the ONE sanctioned Discord client upstream
// of the runtime adapters (per-rule allow in the CI arch test).
const ALLOWED_PREFIXES = ['src/core/delivery/']

const DENYLIST = [
  {
    label: 'concrete adapter import outside adapter factories',
    regex: /@bakin\/adapter-(?:antfly|openclaw|pi)/,
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
  },
  {
    label: 'raw Pi home/path/SDK access outside adapter-pi',
    regex: /(?:~\/\.pi\b|PI_HOME|getPiHome|getPiPath|@earendil-works)/,
  },
  {
    label: 'legacy OpenClaw implementation module',
    regex: /(?:openclaw-home|openclaw-config|openclaw-client|discord-gateway)/,
  },
  {
    label: 'legacy flow_runs task metadata',
    regex: /flow_runs/,
  },
  {
    label: 'raw SQLite access outside adapter packages',
    regex: /(?:bun:sqlite|new\s+Database\b|Database\()/,
  },
  {
    label: 'raw OpenClaw CLI command outside runtime adapter',
    regex: /openclaw\s+(?:cron|flows|agent|config)\b/,
  },
  {
    label: 'raw Discord provider endpoint outside runtime adapter',
    regex: /(?:discord(?:app)?\.com|discord\.gg|discord\/api)/,
  },
  {
    label: 'raw runtime config access outside allowlisted gate',
    regex: /(?:config\.raw|\.raw<)/,
  },
  {
    label: 'provider setup URL outside adapter factory',
    regex: /(?:openclaw\.ai|pi\.dev)/,
  },
]

function readStdin() {
  try {
    return readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

function pathFromHookPayload() {
  const raw = readStdin()
  if (!raw) return ''
  try {
    const payload = JSON.parse(raw)
    return payload?.tool_response?.filePath || payload?.tool_input?.file_path || ''
  } catch {
    return ''
  }
}

function relPath(filePath) {
  return relative(ROOT, filePath).replaceAll('\\', '/')
}

function shouldScanProviderBoundary(rel) {
  if (!EXT_RE.test(rel)) return false
  if (rel.startsWith('packages/adapter-openclaw/') || rel.startsWith('packages/adapter-antfly/')) return false
  if (ALLOWED_FILES.has(rel)) return false
  if (ALLOWED_PREFIXES.some(prefix => rel.startsWith(prefix))) return false
  // The OpenClaw Docker dev rig is inherently OpenClaw-specific dev tooling at
  // the adapter layer (see tests/architecture/adapter-boundary.test.ts). The CI
  // test exempts it per-rule; the edit-time hook exempts it wholesale.
  if (rel === 'scripts/instance.ts' || rel.startsWith('scripts/instance/')) return false
  return CODE_ROOT_RE.test(rel) || CODE_FILE_RE.test(rel)
}

function scanProviderBoundary(rel, src) {
  if (!shouldScanProviderBoundary(rel)) return []

  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of DENYLIST) {
      if (rule.regex.test(line)) {
        hits.push(`${rel}:${i + 1} ${rule.label}: ${line.trim()}`)
      }
    }
  }
  return hits
}

function scanWorkflowAgents(rel, src) {
  if (!WORKFLOW_DEFAULT_RE.test(rel)) return []

  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*agent:\s*(.+?)\s*$/)
    if (!match) continue
    const value = match[1].replace(/^['"]|['"]$/g, '')
    if (!value.startsWith('$')) {
      hits.push(`${rel}:${i + 1} hard-coded shipped workflow agent "${value}"; use "$assigned" or another symbolic token`)
    }
  }
  return hits
}

function check(filePath) {
  const rel = relPath(filePath)
  let src
  try {
    src = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  return [
    ...scanProviderBoundary(rel, src),
    ...scanWorkflowAgents(rel, src),
  ]
}

function format(hits) {
  return [
    'Adapter boundary check failed:',
    '',
    ...hits.map((hit) => `  - ${hit}`),
    '',
    'Route provider access through AppServices/ctx.runtime/ctx.search, and keep shipped workflow defaults portable with symbolic agent tokens.',
    'Run: bun test tests/architecture/adapter-boundary.test.ts --isolate',
  ].join('\n')
}

function main() {
  const cliPath = process.argv[2]
  const filePath = cliPath || pathFromHookPayload()
  if (!filePath) process.exit(0)

  const hits = check(filePath)
  if (hits.length === 0) {
    if (cliPath) console.log(`OK: ${filePath}`)
    process.exit(0)
  }

  if (cliPath) {
    console.error(format(hits))
    process.exit(1)
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `${hits.length} adapter boundary violation(s) in ${filePath}`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: format(hits),
    },
  }))
  process.exit(0)
}

main()
