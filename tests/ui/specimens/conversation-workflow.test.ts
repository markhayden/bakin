import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('conversation and workflow direction specimens', () => {
  it('covers the complete conversation, workflow, and inspector pressure case', () => {
    const story = read('storybook/internal/specimens/conversation-workflow.stories.tsx')

    expect(story).toContain("tags: ['internal']")
    for (const exportName of ['SideBySide', 'KeyboardWorkflow', 'ReducedMotion', 'MobileOperation', 'TextAt200Percent']) {
      expect(story).toContain(`export const ${exportName}`)
    }
    for (const prototype of ['ConversationStream', 'Message', 'ToolActivity', 'Composer', 'InspectorDrawer', 'WorkflowCanvas', 'WorkflowNode']) {
      expect(story).toContain(`function ${prototype}`)
    }
    for (const api of ['PageShell', 'Stack', 'Inline', 'Grid', 'Section', 'BoundedOverflow', 'Action', 'Status', 'TextAreaField', 'SystemState']) {
      expect(story).toMatch(new RegExp(`<${api}(?:\\s|>)`))
    }
    expect(story).not.toMatch(/<(?:input|select|textarea)\b/)
    expect(story).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('makes keyboard, non-drag, reduced-motion, domain-color, overflow, and mobile operation explicit', () => {
    const story = read('storybook/internal/specimens/conversation-workflow.stories.tsx')

    for (const fixture of [
      'Draft a launch update for the spring campaign',
      'workflow://video-social-post/assemble-video',
      'tool:assets.search',
      'asset:campaign/spring-hero-final-v18.webp',
      'provider/openai/gpt-5.2',
      'Streaming response',
    ]) {
      expect(story).toContain(fixture)
    }
    expect(story).toContain("event.key === 'ArrowRight'")
    expect(story).toContain("event.key === 'Enter' && !event.shiftKey")
    expect(story).toContain('Move selected node left')
    expect(story).toContain('Move selected node right')
    expect(story).toContain('No dragging is required')
    expect(story).toContain('@media (prefers-reduced-motion: reduce)')
    expect(story).toContain('animation: none')
    for (const domain of ['trigger', 'agent', 'transform', 'output']) {
      expect(story).toContain(`domain: '${domain}'`)
    }
    expect(story).toContain('label="Scrollable two-dimensional workflow canvas"')
    expect(story).toContain('aria-pressed={mobileView === view}')
    expect(story).toContain("<style>{'html { font-size: 200%; }'}</style>")
    for (const coverage of ['desktop', 'mobile-320', 'text-200', 'streaming', 'tool-activity', 'bounded-2d', 'keyboard-non-drag', 'reduced-motion', 'drawer']) {
      expect(story).toContain(`'${coverage}'`)
    }
  })
})
