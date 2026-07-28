/**
 * `bakin skills` — hub-skill lifecycle (#687).
 *
 *   bakin skills install <url-or-ref> [--yes]   paste-a-link install with the
 *                                               trust-gate preview + consent
 *   bakin skills list [--json]                  managed + unmanaged skills
 *   bakin skills remove <name>                  uninstall by bare skill name
 *   bakin skills map <name>                     agent requirement mapping (T13)
 *
 * Thin HTTP client over /api/skills (the same doors Explore uses). Updates
 * have no dedicated verb: re-running `install <ref>` re-runs the whole gate
 * and re-pins.
 */
import { apiDelete, apiGet, apiPost } from '../http'
import { print } from '../output'
import { printCapabilityStatus, promptMissingSecrets, type InstallCapabilityInfo } from './packages'

interface PreviewBody {
  ok: boolean
  refused?: boolean
  error?: string
  preview?: SkillPreviewWire
}

interface SkillPreviewWire {
  ref: string
  packageId: string
  skillName: string
  version: string
  description?: string
  sourceKind: string
  pinnedRef: string
  files: Array<{ path: string; bytes: number }>
  requirements: {
    secrets: Array<{ name: string; required: boolean; help?: string }>
    prereqs: Array<{ name: string; probe: string; optional: boolean }>
    platforms?: string[]
  }
  mentions: string[]
  warnings: string[]
  risk: Array<{ file: string; line: number; pattern: string; snippet: string }>
  hub?: { downloads?: number; stars?: number; installs?: number }
  verdictState: string
  consentToken: string
}

interface InstallBody {
  ok: boolean
  refused?: boolean
  drift?: boolean
  error?: string
  warnings?: string[]
  installed?: { packageId: string; kind: string }
  preview?: SkillPreviewWire
}

interface SkillsListBody {
  managed: Array<{ skillName: string; packageId: string; version: string; source: string; hub: boolean; capability?: string }>
  unmanaged: Array<{ name: string; scope: string }>
}

const USAGE = `Usage:
  bakin skills install <url-or-ref> [--yes]   Install a skill from ClawHub, GitHub, or a local path
  bakin skills list [--json]                  List managed and unmanaged skills
  bakin skills remove <name>                  Remove an installed skill by name
  bakin skills map <name>                     Map unrecognized requirements via an agent

Refs: paste a clawhub.ai or github.com URL, or use clawhub:@owner/slug /
github:owner/repo[@ref]#subpath / a local path. Re-running install on the
same ref re-checks and re-pins — that IS the update path.`

function fmtBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function renderPreview(p: SkillPreviewWire): void {
  console.log(`\n${p.skillName} v${p.version}  (${p.packageId})`)
  if (p.description) console.log(`  ${p.description}`)
  console.log(`  source: ${p.ref}${p.pinnedRef ? `  (pinned: ${p.pinnedRef})` : ''}`)
  if (p.hub) {
    const bits = [
      p.hub.downloads !== undefined ? `${p.hub.downloads.toLocaleString()} downloads` : null,
      p.hub.stars !== undefined ? `${p.hub.stars.toLocaleString()} stars` : null,
    ].filter(Boolean)
    if (bits.length > 0) console.log(`  clawhub: ${bits.join(' · ')}`)
  }
  if (p.verdictState === 'clean') console.log('  ✓ ClawHub security verdict: clean')
  if (p.verdictState === 'unverified') console.log('  ⚠ ClawHub security verdict UNAVAILABLE — content is unverified')
  if (p.verdictState === 'none') console.log('  ⚠ No hub verdict exists for this source — review the files below')

  console.log(`\n  Files (${p.files.length}):`)
  for (const file of p.files.slice(0, 20)) console.log(`    ${file.path}  ${fmtBytes(file.bytes)}`)
  if (p.files.length > 20) console.log(`    … and ${p.files.length - 20} more`)

  const { secrets, prereqs, platforms } = p.requirements
  if (secrets.length + prereqs.length > 0 || platforms) {
    console.log('\n  Requirements (translated from upstream metadata):')
    for (const s of secrets) console.log(`    key   ${s.name}${s.required ? '' : ' (optional)'}${s.help ? `  — ${s.help}` : ''}`)
    for (const q of prereqs) console.log(`    bin   ${q.probe}${q.optional ? ' (optional)' : ''} — checked, never auto-installed`)
    if (platforms) console.log(`    os    ${platforms.join(', ')}`)
  }
  if (p.mentions.length > 0) {
    console.log(`\n  Mentions env-var-shaped strings (unmapped — no readiness claim): ${p.mentions.join(', ')}`)
    console.log('  If this skill needs keys Bakin did not recognize, run `bakin skills map` after install.')
  }
  for (const warning of p.warnings) console.log(`  ⚠ ${warning}`)

  if (p.risk.length > 0) {
    console.log('\n  ⚠⚠ SECURITY WARNINGS — this content instructs agents to run:')
    for (const r of p.risk) console.log(`    ${r.file}:${r.line} [${r.pattern}] ${r.snippet}`)
    console.log('  Agents WILL execute skill instructions. Only proceed if you trust this source.')
  }
}

async function confirm(question: string): Promise<boolean> {
  const readline = await import('node:readline/promises')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

async function printPostInstallReadiness(packageId: string): Promise<void> {
  try {
    const result = await apiGet('/api/packages/capabilities') as { capabilities?: InstallCapabilityInfo[] }
    const cap = (result.capabilities ?? []).find((c) => (c as { packageId?: string }).packageId === packageId.split('@')[0])
    if (!cap) return
    printCapabilityStatus(cap)
    if (!cap.ready) await promptMissingSecrets(cap)
  } catch {
    // Readiness print is best-effort — install already succeeded.
  }
}

async function cmdInstall(ref: string | undefined, yes: boolean): Promise<void> {
  if (!ref) {
    console.error('Usage: bakin skills install <url-or-ref> [--yes]')
    process.exit(1)
  }

  const previewBody = await apiPost('/api/skills/preview', { ref }) as PreviewBody
  if (!previewBody.ok || !previewBody.preview) {
    console.error(previewBody.refused ? `Refused: ${previewBody.error}` : `Error: ${previewBody.error}`)
    process.exit(previewBody.refused ? 2 : 1)
  }

  let preview = previewBody.preview
  for (let attempt = 0; attempt < 2; attempt++) {
    renderPreview(preview)
    if (!yes) {
      const proceed = await confirm('\nInstall this skill?')
      if (!proceed) {
        console.log('Aborted — nothing installed.')
        process.exit(0)
      }
    }

    const installBody = await apiPost('/api/skills/install', { ref, consentToken: preview.consentToken }) as InstallBody
    if (installBody.ok && installBody.installed) {
      console.log(`\n✓ Installed ${preview.skillName} v${preview.version} (${installBody.installed.packageId})`)
      for (const warning of installBody.warnings ?? []) console.log(`  ⚠ ${warning}`)
      await printPostInstallReadiness(installBody.installed.packageId)
      return
    }
    if (installBody.drift && installBody.preview) {
      console.log('\n⚠ The skill content CHANGED between preview and install — review again:')
      preview = installBody.preview
      continue
    }
    console.error(installBody.refused ? `Refused: ${installBody.error}` : `Error: ${installBody.error}`)
    process.exit(installBody.refused ? 2 : 1)
  }
  console.error('Content kept changing between preview and install — aborting. Try again later.')
  process.exit(1)
}

async function cmdList(json: boolean): Promise<void> {
  const body = await apiGet('/api/skills') as SkillsListBody
  if (json) {
    print(body)
    return
  }
  if (body.managed.length === 0 && body.unmanaged.length === 0) {
    console.log('No skills installed. Try: bakin skills install <clawhub.ai or github.com URL>')
    return
  }
  if (body.managed.length > 0) {
    console.log('Managed skills:')
    for (const row of body.managed) {
      const origin = row.hub ? 'hub' : 'pack'
      console.log(`  ${row.skillName}  v${row.version}  [${origin}]  ${row.source}`)
    }
  }
  if (body.unmanaged.length > 0) {
    console.log('\nUnmanaged runtime skills (not Bakin-managed):')
    for (const row of body.unmanaged) console.log(`  ${row.name}  (${row.scope})`)
  }
}

/** Bare names everywhere user-facing (D19): resolve name → lockfile key. */
async function resolveLockKey(name: string): Promise<string> {
  const body = await apiGet('/api/skills') as SkillsListBody
  const row = body.managed.find((r) => r.skillName === name)
    ?? body.managed.find((r) => r.packageId === name || r.packageId.startsWith(`${name}@`))
  if (!row) {
    const known = body.managed.map((r) => r.skillName).join(', ') || '(none)'
    console.error(`No managed skill named "${name}". Installed: ${known}`)
    process.exit(1)
  }
  return row.packageId
}

async function cmdRemove(name: string | undefined): Promise<void> {
  if (!name) {
    console.error('Usage: bakin skills remove <name>')
    process.exit(1)
  }
  const lockKey = await resolveLockKey(name)
  const result = await apiDelete(`/api/packages/${encodeURIComponent(lockKey)}`) as { ok?: boolean; error?: string }
  if (result.ok === false) {
    console.error(`Error: ${result.error ?? 'remove failed'}`)
    process.exit(1)
  }
  console.log(`✓ Removed ${name} (${lockKey})`)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  const rest = args.slice(2)
  const yes = rest.includes('--yes') || rest.includes('-y')
  const json = rest.includes('--json')
  const positional = rest.filter((a) => !a.startsWith('-'))

  switch (sub) {
    case 'install':
      await cmdInstall(positional[0], yes)
      break
    case 'list':
      await cmdList(json)
      break
    case 'remove':
      await cmdRemove(positional[0])
      break
    case 'map':
      console.error('`bakin skills map` is not available yet — it ships with the agent mapping lane (#687 T13).')
      process.exit(1)
      break
    default:
      console.log(USAGE)
      process.exit(sub === undefined || sub === 'help' || sub === '--help' ? 0 : 1)
  }
}
