/**
 * Seed team-surface content: personas (#585), agent lessons (search +
 * lessons tab), and a WebP avatar (dual-format support, #515/#339).
 *
 * Personas are plain markdown at `team/personas/<agentId>.md` — the shape the
 * team plugin's health check and the agent-package projector both expect.
 * Lessons live in the installed-package tree
 * (`packages/agents/<agentId>@<version>/lessons/<lessonId>.md`) with the
 * line-based lesson frontmatter (title / defaultEnabled / tags) — the
 * agent-lessons search content type and the team page lessons tab enumerate
 * that path directly.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')

const PERSONAS: Record<string, string> = {
  main: `# Roscoe

The orchestrator. Calm under load, allergic to busywork, keeps the team pointed
at the highest-leverage task. Writes terse status updates and expects the same.

- **Voice:** direct, dry, occasionally sardonic
- **Strengths:** prioritization, delegation, catching scope creep early
- **Quirk:** ends standups with a one-line weather report nobody asked for
`,
  pixel: `# Pixel

The visual one. Generates, edits, and obsesses over imagery — if it ships with
a picture, Pixel touched it. Strong opinions about crops and color grades.

- **Voice:** enthusiastic, emoji-adjacent but restrained on the record
- **Strengths:** image generation, brand consistency, fast iteration
- **Quirk:** refuses to call anything "final" until v3
`,
  rolo: `# Rolo

The operator. Inboxes, schedules, reports — the recurring machinery of the
team runs through Rolo. Never misses a cron fire, files everything.

- **Voice:** methodical, bullet-pointed, zero fluff
- **Strengths:** triage, recurring workflows, metrics rollups
- **Quirk:** timestamps everything, even lunch
`,
  jessica: `# Jessica

The wordsmith. Owns copy, captions, and long-form drafts. Edits ruthlessly —
her second drafts are everyone else's fifth.

- **Voice:** warm but precise; hates filler words
- **Strengths:** brand voice, editorial judgment, headline options on demand
- **Quirk:** keeps a running list of words the team is no longer allowed to use
`,
  patch: `# Patch

The fixer. Quiet most of the week, indispensable when something breaks.
Reads stack traces like weather maps.

- **Voice:** minimal; answers in diffs when possible
- **Strengths:** debugging, recovery ladders, root-cause writeups
- **Quirk:** names every incident after a sandwich
`,
}

interface LessonSpec {
  agent: string
  version: string
  lessonId: string
  title: string
  defaultEnabled: boolean
  tags: string[]
  body: string
}

const LESSONS: LessonSpec[] = [
  {
    agent: 'pixel', version: '1.0.0', lessonId: 'brand-color-grade',
    title: 'Brand color grade', defaultEnabled: true, tags: ['style', 'images'],
    body: 'Food photography leans warm: +200K temperature, lifted shadows, never crush the blacks. Product shots stay neutral. When in doubt, match the gourmet-popcorn reference asset.',
  },
  {
    agent: 'pixel', version: '1.0.0', lessonId: 'no-text-in-images',
    title: 'No baked-in text', defaultEnabled: true, tags: ['images', 'accessibility'],
    body: 'Never render headline text inside generated images — captions live in the post copy where they stay editable and accessible. Exception: menu boards where the text IS the subject.',
  },
  {
    agent: 'pixel', version: '1.0.0', lessonId: 'square-first-crops',
    title: 'Square-first crops', defaultEnabled: false, tags: ['style'],
    body: 'Compose for a 1:1 crop first; most surfaces take square. Keep critical detail out of the outer 12% so 4:5 and 16:9 derivations survive.',
  },
  {
    agent: 'jessica', version: '1.0.0', lessonId: 'banned-words',
    title: 'Banned words list', defaultEnabled: true, tags: ['voice', 'copy'],
    body: 'Never use: "elevate", "delve", "unleash", "game-changer", "mouthwatering". Prefer concrete sensory detail over adjectives — "brown-butter and flaky salt" beats "irresistibly delicious".',
  },
  {
    agent: 'jessica', version: '1.0.0', lessonId: 'cta-last-line',
    title: 'CTA on the last line', defaultEnabled: true, tags: ['copy', 'structure'],
    body: 'Every post ends with exactly one call to action, on its own line, phrased as an invitation not a command. Link goes in the CTA line, never mid-paragraph.',
  },
]

export function seedTeamContent(mockHome: string): void {
  // Personas — one plain-markdown file per agent.
  const personasDir = join(mockHome, 'team', 'personas')
  mkdirSync(personasDir, { recursive: true })
  for (const [agentId, body] of Object.entries(PERSONAS)) {
    writeFileSync(join(personasDir, `${agentId}.md`), body, 'utf-8')
  }

  // Lessons — installed-package tree layout; lessonId is the filename. Each
  // package also needs a bakin-package.json: the lessons tab reads the
  // manifest's contributions.lessons to enumerate files.
  let lessonCount = 0
  const lessonsByAgent = new Map<string, LessonSpec[]>()
  for (const l of LESSONS) {
    lessonsByAgent.set(l.agent, [...(lessonsByAgent.get(l.agent) ?? []), l])
  }
  for (const [agent, lessons] of lessonsByAgent) {
    const pkgDir = join(mockHome, 'packages', 'agents', `${agent}@${lessons[0].version}`)
    const dir = join(pkgDir, 'lessons')
    mkdirSync(dir, { recursive: true })
    for (const l of lessons) {
      const frontmatter = [
        '---',
        `title: ${l.title}`,
        `defaultEnabled: ${l.defaultEnabled}`,
        `tags: [${l.tags.join(', ')}]`,
        '---',
      ].join('\n')
      writeFileSync(join(dir, `${l.lessonId}.md`), `${frontmatter}\n${l.body}\n`, 'utf-8')
      lessonCount++
    }
    const manifest = {
      id: agent,
      name: `${agent[0].toUpperCase()}${agent.slice(1)} (mock)`,
      version: lessons[0].version,
      kind: 'agent',
      agent: { identity: { name: agent } },
      install: {},
      contributions: { lessons: lessons.map(l => `lessons/${l.lessonId}.md`) },
    }
    writeFileSync(join(pkgDir, 'bakin-package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  }

  // Lockfile entries — the lessons tab resolves an agent's package through
  // packages/lock.json (not by walking the dir), so the seeded lesson trees
  // need matching install-ledger entries. lessonsEnabled mirrors each
  // lesson's defaultEnabled so one lesson (square-first-crops) demos the
  // disabled state.
  // Read-merge like seed-enrich.ts does — the two seed steps must not depend
  // on their call order to both land in the lockfile.
  const lockPath = join(mockHome, 'packages', 'lock.json')
  mkdirSync(join(mockHome, 'packages'), { recursive: true })
  const lock = readLockfile(lockPath)
  for (const [agent, lessons] of lessonsByAgent) {
    lock.packages[agent] = {
      kind: 'agent',
      version: lessons[0].version,
      source: `mock:${agent}`,
      ref: '',
      commitSha: '',
      installedAt: new Date().toISOString(),
      state: 'managed',
      agentId: agent,
      lessonsEnabled: lessons.filter(l => l.defaultEnabled).map(l => l.lessonId),
      projections: [],
    }
  }
  writeLockfile(lock, lockPath)

  // WebP avatar for pixel — exercises the dual-format resolver (webp wins
  // over the jpg the generic avatar seeder would otherwise place).
  const webp = join(FIXTURES_DIR, 'avatars', 'pixel.webp')
  if (existsSync(webp)) {
    const dir = join(mockHome, 'agents', 'pixel')
    mkdirSync(dir, { recursive: true })
    cpSync(webp, join(dir, 'avatar.webp'))
  }

  console.log(`[seed] Team content seeded (${Object.keys(PERSONAS).length} personas, ${lessonCount} lessons, 1 webp avatar)`)
}
