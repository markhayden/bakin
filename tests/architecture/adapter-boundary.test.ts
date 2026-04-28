import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCAN_ROOTS = [
  'src',
  'plugins',
  'packages/core/src',
  'packages/host/src',
  'cli',
  'scripts',
  'server.ts',
]
const EXT_RE = /\.(ts|tsx|mjs|mts)$/

const DENYLIST = [
  {
    label: 'concrete adapter import outside adapter factories',
    regex: /@bakin\/adapter-(?:antfly|openclaw)/,
    allow: (rel: string) => rel === 'src/core/search-adapter-factory.ts' || rel === 'src/core/runtime-adapter-factory.ts',
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
    allow: (rel: string) => rel === 'scripts/bin/check-home-bypasses.mjs',
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
    label: 'task metadata access through plugin hooks',
    regex: /tasks\.(?:readTaskboard|addTaskLog|updateTask|moveTask|blockTask|createTask|setDependency|clearDependency|deleteTask)/,
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
    allow: (rel: string) => rel === 'src/core/runtime-config-raw.ts',
  },
  {
    label: 'provider setup URL outside adapter factory',
    regex: /openclaw\.ai/,
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
})
