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
    const graph = read('storybook/internal/specimens/workflow-graph.tsx')
    const specimen = `${story}\n${graph}`

    expect(story).toContain("tags: ['internal']")
    for (const exportName of ['SideBySide', 'VerticalWorkflow', 'HorizontalWorkflow', 'VerticalAt200Percent', 'HorizontalAt200Percent', 'ReducedMotion', 'MobileOperation', 'TextAt200Percent']) {
      expect(story).toContain(`export const ${exportName}`)
    }
    for (const prototype of ['ConversationStream', 'Message', 'ToolActivity', 'Composer', 'InspectorDrawer', 'WorkflowCanvas', 'WorkflowNode']) {
      expect(specimen).toContain(`function ${prototype}`)
    }
    for (const api of ['PageShell', 'Stack', 'Inline', 'Grid', 'Section', 'BoundedOverflow', 'Action', 'Status', 'TextAreaField', 'SystemState']) {
      expect(specimen).toMatch(new RegExp(`<${api}(?:\\s|>)`))
    }
    expect(story).not.toMatch(/<(?:input|select|textarea)\b/)
    expect(specimen).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('defaults to a vertical workflow while keeping horizontal as an explicit option', () => {
    const story = read('storybook/internal/specimens/conversation-workflow.stories.tsx')
    const graph = read('storybook/internal/specimens/workflow-graph.tsx')

    expect(graph).toContain("export type WorkflowOrientation = 'vertical' | 'horizontal'")
    expect(graph).toContain("orientation = 'vertical'")
    expect(graph).toContain('data-orientation={orientation}')
    expect(graph).toContain("orientation === 'vertical' ? Position.Top : Position.Left")
    expect(graph).toContain("orientation === 'vertical' ? Position.Bottom : Position.Right")
    expect(graph).toContain("position={orientation === 'vertical' ? 'top-right' : 'bottom-right'}")
    expect(graph).toContain(".bakin-workflow[data-orientation='vertical'] .react-flow__minimap")
    for (const action of ['Move selected node up', 'Move selected node down', 'Move selected node left', 'Move selected node right']) {
      expect(graph).toContain(action)
    }
    expect(story).toContain('<WorkflowStudy orientation="vertical" />')
    expect(story).toContain('<WorkflowStudy orientation="horizontal" />')
    expect(story).toContain('<WorkflowStudy orientation="vertical" text200 />')
    expect(story).toContain('<WorkflowStudy orientation="horizontal" text200 />')
    expect(story).toContain("'vertical-flow'")
    expect(story).toContain("'horizontal-flow'")
  })

  it('uses the real React Flow interaction model instead of a CSS grid stand-in', () => {
    const story = read('storybook/internal/specimens/conversation-workflow.stories.tsx')
    const graph = read('storybook/internal/specimens/workflow-graph.tsx')

    expect(graph).toContain("from '@xyflow/react'")
    expect(graph).toContain("import '@xyflow/react/dist/style.css'")
    for (const primitive of ['ReactFlow', 'Handle', 'Background', 'Controls', 'MiniMap']) {
      expect(graph).toMatch(new RegExp(`<${primitive}(?:\\s|>)`))
    }
    expect(graph).toContain('const workflowNodeTypes')
    expect(graph).toContain('nodeTypes={workflowNodeTypes}')
    expect(graph).toContain('onNodesChange={onNodesChange}')
    expect(graph).toContain('disableKeyboardA11y={false}')
    expect(graph).toContain('className="bakin-workflow-canvas-shell"')
    expect(graph).toContain('container-type: inline-size')
    expect(graph).toMatch(/@container \(max-width: [^)]+\)/)
    expect(graph).toContain('getComputedStyle(document.documentElement).fontSize')
    expect(graph).toContain('instance.fitView')
    expect(story).not.toContain('grid-template-columns: repeat(4, 12rem)')
    expect(story).not.toContain('style={{ gridColumn: column, gridRow: node.row }}')
  })

  it('makes keyboard, non-drag, reduced-motion, domain-color, overflow, and mobile operation explicit', () => {
    const story = read('storybook/internal/specimens/conversation-workflow.stories.tsx')
    const graph = read('storybook/internal/specimens/workflow-graph.tsx')
    const specimen = `${story}\n${graph}`

    for (const fixture of [
      'Draft a launch update for the spring campaign',
      'workflow://video-social-post/assemble-video',
      'tool:assets.search',
      'asset:campaign/spring-hero-final-v18.webp',
      'provider/openai/gpt-5.2',
      'Streaming response',
    ]) {
      expect(specimen).toContain(fixture)
    }
    expect(graph).toContain('disableKeyboardA11y={false}')
    expect(story).toContain("event.key === 'Enter' && !event.shiftKey")
    expect(graph).toContain('Move selected node left')
    expect(graph).toContain('Move selected node right')
    expect(graph).toContain('No dragging is required')
    expect(story).toContain('@media (prefers-reduced-motion: reduce)')
    expect(story).toContain('animation: none')
    for (const domain of ['trigger', 'agent', 'transform', 'output']) {
      expect(graph).toContain(`domain: '${domain}'`)
    }
    expect(graph).toContain('label="Scrollable two-dimensional workflow canvas"')
    expect(story).toContain('aria-pressed={mobileView === view}')
    expect(story).toContain("<style>{'html { font-size: 200%; }'}</style>")
    for (const coverage of ['desktop', 'mobile-320', 'text-200', 'streaming', 'tool-activity', 'bounded-2d', 'keyboard-non-drag', 'reduced-motion', 'drawer']) {
      expect(story).toContain(`'${coverage}'`)
    }
  })
})
