'use client'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import type { Heartbeat } from '@/types'

function formatAge(timestamp: string) {
  const ms = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

const AGENT_PROFILES: Record<string, {
  emoji: string
  name: string
  title: string
  headshot: string
  model: string
  definition: string
  shouldDo: string[]
  shouldNotDo: string[]
  examples: string[]
  tools: string[]
}> = {
  main-operator: {
    emoji: '🐾',
    name: 'Main Operator',
    title: 'Orchestrator · Lead Agent',
    headshot: '/headshots/main-operator.png',
    model: 'claude-sonnet-4-6',
    definition: 'Main Operator is the team lead and orchestrator. He receives tasks from Mark, triages them to the right agent, monitors progress, and assembles final deliverables. He owns the pipeline from brief to publish.',
    shouldDo: [
      'Triage incoming tasks and assign to the right agent',
      'Spawn subagents for content, design, and development work',
      'Assemble final deliverables from multiple agents',
      'Post finished content to Discord and other channels',
      'Keep TASKBOARD.md clean and up to date',
      'Report blockers to Mark immediately',
    ],
    shouldNotDo: [
      'Write detailed copy or recipes — that\'s Chef',
      'Generate images — that\'s Pixel',
      'Produce video — that\'s Rolo',
      'Build features or fix bugs — that\'s Patch',
      'Break down tasks into subtasks on the board (agents own their own execution)',
    ],
    examples: [
      '"Create a healthy corn recipe post" → spawn Chef, wait for copy, then trigger Pixel',
      '"Fix the login bug" → assign to Patch with full context',
      '"Post the finished chicken & waffles content to Discord" → assemble + post',
    ],
    tools: ['Discord messaging', 'Task board management', 'Subagent spawning', 'File read/write'],
  },
  chef: {
    emoji: '🥗',
    name: 'Chef',
    title: 'Nutritionist & Culinary Expert · Content Creator',
    headshot: '/headshots/chef.png',
    model: 'claude-sonnet-4-6',
    definition: 'Chef is a nutritionist and culinary expert who creates food and wellness content for social media. She writes recipes, captions, and content strategies — and briefs Pixel and Rolo on the assets she needs.',
    shouldDo: [
      'Develop healthy, appealing recipes with accurate macros',
      'Write social media captions in an authentic nutritionist voice',
      'Create content briefs for Pixel (images) and Rolo (video)',
      'Spawn Pixel and Rolo directly when assets are needed',
      'Research food trends, ingredients, and nutrition science',
      'Write copy for Instagram, TikTok, and other platforms',
    ],
    shouldNotDo: [
      'Generate images — brief Pixel instead',
      'Produce video — brief Rolo instead',
      'Post content to Discord — hand off to Main Operator',
      'Write code or fix technical issues — that\'s Patch',
      'Make up nutritional data — research and verify',
    ],
    examples: [
      '"Chicken & waffles post" → write recipe + caption → brief Pixel on hero shot → brief Rolo on 60-sec reel',
      '"Healthy corn recipe" → develop Street Corn Power Bowl, write IG carousel copy, hand off assets brief',
    ],
    tools: ['Web search (nutrition research)', 'File read/write', 'Subagent messaging (Pixel, Rolo)'],
  },
  pixel: {
    emoji: '🖼️',
    name: 'Pixel',
    title: 'Image Generation · Visual Content',
    headshot: '/headshots/pixel.png',
    model: 'claude-sonnet-4-6',
    definition: 'Pixel generates images for the content pipeline — food photography, character portraits, branded graphics, and social media visuals. She works from briefs provided by Chef or Main Operator.',
    shouldDo: [
      'Generate high-quality images from detailed briefs',
      'Match the style, mood, and crop specified in the brief',
      'Save outputs to content/assets/ with descriptive filenames',
      'Report back to Main Operator with file paths when done',
      'Ask for clarification if a brief is too vague',
    ],
    shouldNotDo: [
      'Start generating without a brief — wait for Chef or Main Operator',
      'Write copy or captions — that\'s Chef',
      'Post images directly to Discord — let Main Operator assemble',
      'Build or fix code — that\'s Patch',
    ],
    examples: [
      'Hero shot for chicken & waffles post — overhead, natural light, 4:5 portrait',
      'Frontier-style character portrait headshots for all 5 agents',
      'Ingredient flat lay for corn recipe carousel',
    ],
    tools: ['Nano Banana / Nano Banana Pro (image generation)', 'File read/write'],
  },
  rolo: {
    emoji: '🎬',
    name: 'Rolo',
    title: 'Videographer & Editor · Video Content',
    headshot: '/headshots/rolo.png',
    model: 'claude-sonnet-4-6',
    definition: 'Rolo produces and edits video content for the content pipeline — recipe walkthroughs, short-form reels, and social media videos. He works from briefs provided by Chef or Main Operator.',
    shouldDo: [
      'Produce short-form recipe and lifestyle videos from briefs',
      'Follow the shot list and timing provided by Chef',
      'Save video outputs to content/assets/ with metadata',
      'Report back to Main Operator with file paths when done',
    ],
    shouldNotDo: [
      'Start producing without a brief from Chef',
      'Write copy or captions — that\'s Chef',
      'Generate static images — that\'s Pixel',
      'Build or fix code — that\'s Patch',
    ],
    examples: [
      '60-sec TikTok recipe walkthrough for chicken & waffles — opens on hot honey drizzle',
      'Ingredient montage reel for corn power bowl',
    ],
    tools: ['Video LLM pipeline', 'File read/write'],
  },
  patch: {
    emoji: '⚙️',
    name: 'Patch',
    title: 'Lead Developer',
    headshot: '/headshots/patch.png',
    model: 'claude-opus-4-6 · Claude Code',
    definition: 'Patch is the lead developer for Mission Control. He builds integrations, fixes bugs, extends the tooling, and keeps the technical infrastructure running. He uses Claude Code (with claude-opus-4-6) for all coding tasks — giving him deep file exploration, multi-step execution, and the ability to run builds and tests.',
    shouldDo: [
      'Use Claude Code (claude-opus-4-6) for all coding tasks — not plain chat',
      'Fix bugs in the Mission Control codebase',
      'Build new features and integrations',
      'Refactor and improve existing code quality',
      'Write clean, well-documented TypeScript/Next.js',
      'Run builds and verify things work before reporting done',
      'Report blockers or scope questions to Main Operator before guessing',
    ],
    shouldNotDo: [
      'Write recipes or content copy — that\'s Chef',
      'Generate images or video — that\'s Pixel or Rolo',
      'Make product decisions without checking with Main Operator/Mark',
      'Deploy to production without approval',
      'Use a lesser model for coding — always use opus-4-6 via Claude Code',
    ],
    examples: [
      'Fix the dual-writer race condition in server.ts and taskboard.ts',
      'Add agent detail drawer to the Team page',
      'Build a scheduling system for content publishing',
    ],
    tools: ['Claude Code (claude-opus-4-6)', 'Full codebase access', 'File read/write/exec', 'npm/git', 'TypeScript · Next.js · Node.js'],
  },
}

interface AgentDrawerProps {
  agentId: string | null
  heartbeat?: Heartbeat
  open: boolean
  onClose: () => void
}

export function AgentDrawer({ agentId, heartbeat, open, onClose }: AgentDrawerProps) {
  const profile = agentId ? AGENT_PROFILES[agentId] : null
  if (!profile) return null

  const isActive = heartbeat && (Date.now() - new Date(heartbeat.timestamp).getTime()) < 15 * 60 * 1000

  return (
    <Sheet open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-6">
        <SheetHeader>
          <div className="flex items-center gap-4 mb-2">
            <img src={profile.headshot} alt={profile.name} className="size-16 rounded-xl object-cover object-top" />
            <div>
              <SheetTitle className="text-lg">{profile.name}</SheetTitle>
              <div className="text-sm text-muted-foreground">{profile.title}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
                  {isActive ? `active · ${formatAge(heartbeat!.timestamp)}` : 'standby'}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">{profile.model}</span>
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 mt-4">

          {/* Definition */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Who They Are</h3>
            <p className="text-sm text-foreground leading-relaxed">{profile.definition}</p>
          </section>

          {/* Should Do */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400 mb-2">✅ Should Do</h3>
            <ul className="space-y-1.5">
              {profile.shouldDo.map((item, i) => (
                <li key={i} className="text-sm text-foreground flex gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Should Not Do */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 mb-2">🚫 Should Not Do</h3>
            <ul className="space-y-1.5">
              {profile.shouldNotDo.map((item, i) => (
                <li key={i} className="text-sm text-foreground flex gap-2">
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Examples */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Examples</h3>
            <ul className="space-y-2">
              {profile.examples.map((item, i) => (
                <li key={i} className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2 leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {/* Tools */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tools & Access</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.tools.map((tool, i) => (
                <Badge key={i} variant="outline" className="text-xs font-normal">{tool}</Badge>
              ))}
            </div>
          </section>

          {/* Live heartbeat */}
          {heartbeat && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Live Status</h3>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-mono">{heartbeat.status}</span>
                </div>
                {heartbeat.currentTask && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current task</span>
                    <span className="max-w-[200px] text-right">{heartbeat.currentTask}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last heartbeat</span>
                  <span className="font-mono">{formatAge(heartbeat.timestamp)}</span>
                </div>
              </div>
            </section>
          )}

        </div>
      </SheetContent>
    </Sheet>
  )
}
