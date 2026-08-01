/**
 * No hard navigation for internal routes (routing overhaul, spec
 * .claude/specs/routing-overhaul.md D3).
 *
 * Internal navigation must go through the SPA router — PluginLink /
 * TanStack Link / useRouter().push — never a full page load. A hard
 * navigation re-boots the whole shell (manifest fetch, plugin loads, SSE
 * reconnect) and loses in-memory state.
 *
 * Banned in client-side code:
 *   - window.location.assign/replace, `location.href =` assignments
 *   - window.location.reload outside the pinned recovery paths
 *   - raw <a href="/..."> anchors to internal SPA routes
 *
 * Every allowlisted file is a deliberate full reload with a reason below.
 * If you're adding a new one, it must be a recovery/dev-tooling path — not
 * a user-facing link. ESLint mirrors these bans (eslint.config.mjs) for
 * in-editor feedback; this test is the CI gate.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

// Client-side code only: server code has no window and full-page anchors in
// docs/emails are fine. src/{components,hooks,lib,context} are client-shared.
const SCAN_ROOTS = [
  'packages/host/src',
  'packages/sdk/src',
  'plugins',
  'src/components',
  'src/hooks',
  'src/lib',
  'src/context',
]
const EXT_RE = /\.(ts|tsx|jsx)$/

// Server-side / dev-tooling subtrees inside otherwise-client roots.
const EXCLUDED = [
  'packages/host/src/api/', // Fetch-style server handlers — no window here
  'packages/host/src/dev-client/', // dev loop: reloads/CSS swaps by design
]

interface Ban {
  label: string
  regex: RegExp
  /** Repo-relative paths allowed to keep the pattern, each with a reason. */
  allow?: (rel: string) => boolean
  /** Teeth: snippets the regex MUST catch / MUST ignore. */
  catches: string[]
  ignores: string[]
}

const BANS: Ban[] = [
  {
    label: 'window.location.assign/replace (use useRouter().push / PluginLink)',
    regex: /(?:window\.)?location\.(?:assign|replace)\(/,
    allow: (rel) =>
      // Deliberately re-issues an intercepted same-origin navigation as a
      // full load after the user confirms discarding unsaved changes.
      rel === 'packages/sdk/src/navigation/unsaved-changes-guard.tsx'
      // Hard-navigation fallback when the shell's navigate bridge isn't
      // registered (notification clicked before boot).
      || rel === 'src/lib/browser-notify.ts',
    catches: [
      'window.location.assign(`/chat?chat=${id}`)',
      'location.replace("/tasks")',
    ],
    ignores: [
      'router.replace(buildUrl(v), { scroll: false })',
      'params.replace("a", "b")',
    ],
  },
  {
    label: '`location.href =` assignment (use useRouter().push / PluginLink)',
    regex: /location\.href\s*=[^=]/,
    catches: [
      'window.location.href = attention.url',
      'location.href = "/tasks"',
    ],
    ignores: [
      'if (window.location.href === url) return',
      'const current = new URL(window.location.href)',
    ],
  },
  {
    label: 'window.location.reload outside pinned recovery paths',
    regex: /location\.reload\(/,
    allow: (rel) =>
      // Post-update recovery once /api/version comes back after a restart.
      rel === 'packages/host/src/components/layout/header.tsx'
      // Explicit "Reload" button in the plugin-boot-failure banner.
      || rel === 'packages/host/src/plugin-host/PluginHost.tsx'
      // The public router.refresh() API — a full reload is its contract.
      || rel === 'packages/sdk/src/navigation/router.ts'
      // Runtime manifest changed; non-dev tabs must re-boot to pick it up.
      || rel === 'src/hooks/use-sse.ts',
    catches: ['window.location.reload()'],
    ignores: ['router.refresh()'],
  },
  {
    label: 'raw internal <a href="/..."> anchor (use PluginLink / Link)',
    // JSX href literals starting with "/": href="/x", href={'/x'}, href={`/x…`}.
    // /api/ is exempt — those are real server resources (downloads, exports),
    // not SPA routes.
    regex: /href=\{?["'`]\/(?!api\/|\/)/,
    catches: [
      '<a href="/models?tab=spend">spend</a>',
      "<a href={'/brands'}>brands</a>',",
      '<a href={`/team/${entry.id}`}>team</a>',
    ],
    ignores: [
      '<a href="https://example.com/docs">docs</a>',
      '<a href="/api/assets/abc/export/print.pdf">download</a>',
      '<a href={to}>generic</a>',
      "href: '/models?tab=spend',",
      '<a href="#section">jump</a>',
    ],
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
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && EXT_RE.test(entry.name)) out.push(full)
  }
  return out
}

function scanFiles(): string[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) walk(join(ROOT, root), files)
  return files.filter((f) => !EXCLUDED.some((ex) => relative(ROOT, f).startsWith(ex)))
}

describe('no hard navigation for internal routes', () => {
  const files = scanFiles()

  it('scans a plausible client-side file set', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  for (const ban of BANS) {
    it(`bans: ${ban.label}`, () => {
      const offenders: string[] = []
      for (const file of files) {
        const rel = relative(ROOT, file)
        if (ban.allow?.(rel)) continue
        const content = readFileSync(file, 'utf8')
        if (!ban.regex.test(content)) continue
        for (const [i, line] of content.split('\n').entries()) {
          if (ban.regex.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
      }
      expect(offenders).toEqual([])
    })
  }

  // Teeth: prove each regex bites its offenders and spares legit code —
  // a regex edit that silently stops matching fails here, not in review.
  for (const ban of BANS) {
    it(`teeth: ${ban.label}`, () => {
      for (const snippet of ban.catches) {
        expect(ban.regex.test(snippet)).toBe(true)
      }
      for (const snippet of ban.ignores) {
        expect(ban.regex.test(snippet)).toBe(false)
      }
    })
  }

  it('allowlisted files still exist (stale entries rot the allowlist)', () => {
    const pinned = [
      'packages/sdk/src/navigation/unsaved-changes-guard.tsx',
      'src/lib/browser-notify.ts',
      'packages/host/src/components/layout/header.tsx',
      'packages/host/src/plugin-host/PluginHost.tsx',
      'packages/sdk/src/navigation/router.ts',
      'src/hooks/use-sse.ts',
    ]
    for (const rel of pinned) {
      expect(() => readFileSync(join(ROOT, rel), 'utf8')).not.toThrow()
    }
  })
})
