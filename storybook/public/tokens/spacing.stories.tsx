import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { GENERATED_TOKENS } from '../../support/tokens.data'

const cssVar = (path: string) => `--bakin-${path.replace(/^semantic\./, '').replace(/\./g, '-')}`
const dim = (value: unknown) => {
  const v = value as { unit?: string; value?: number }
  return v && typeof v === 'object' && 'value' in v ? `${v.value}${v.unit ?? ''}` : String(value)
}

const DIMENSIONS = GENERATED_TOKENS
  .filter((token) => token.type === 'dimension' && token.visibility === 'public' && token.layer === 'semantic')
const SPACE = DIMENSIONS.filter((token) => token.path.includes('.space.') || token.path.includes('.size.'))
const RADII = DIMENSIONS.filter((token) => token.path.includes('.radius.'))

const CSS = `
.bakin-space-doc { min-height: 100vh; background: var(--bakin-color-canvas-default); color: var(--bakin-color-text-primary); padding: var(--bakin-layout-space-8); font-family: var(--bakin-typography-family-ui); }
.bakin-space-doc__content { width: min(100%, 64rem); margin: 0 auto; }
.bakin-space-doc h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1; letter-spacing: -.045em; }
.bakin-space-doc h2 { margin: var(--bakin-layout-space-8) 0 var(--bakin-layout-space-3); font-size: 1.125rem; }
.bakin-space-doc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bakin-layout-space-2); }
.bakin-space-row { display: grid; grid-template-columns: minmax(14rem, .5fr) 5rem minmax(0, 1fr); gap: var(--bakin-layout-space-3); align-items: center; }
.bakin-space-row code { font-family: var(--bakin-typography-family-mono); font-size: .75rem; overflow-wrap: anywhere; }
.bakin-space-row small { color: var(--bakin-color-text-muted); font-variant-numeric: tabular-nums; }
.bakin-space-row__bar { block-size: .75rem; background: var(--bakin-color-signal-accent); border-radius: 2px; }
.bakin-radius-chip { inline-size: 4rem; block-size: 2.5rem; background: var(--bakin-color-surface-elevated); border: 1px solid var(--bakin-color-border-subtle); }
@media (max-width: 44rem) { .bakin-space-doc { padding: var(--bakin-layout-space-4); } .bakin-space-row { grid-template-columns: 1fr; gap: var(--bakin-layout-space-1); } }
`

function SpacingDoc() {
  return (
    <div className="bakin-space-doc">
      <style>{CSS}</style>
      <div className="bakin-space-doc__content">
        <h1>Spacing &amp; radius</h1>
        <h2>Layout scale</h2>
        <ul>
          {SPACE.map((token) => (
            <li key={token.path} className="bakin-space-row" aria-label={token.path}>
              <code>{cssVar(token.path)}</code>
              <small>{dim(token.value)}</small>
              <span className="bakin-space-row__bar" style={{ inlineSize: `var(${cssVar(token.path)})` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
        <h2>Radii</h2>
        <ul>
          {RADII.map((token) => (
            <li key={token.path} className="bakin-space-row" aria-label={token.path}>
              <code>{cssVar(token.path)}</code>
              <small>{dim(token.value)}</small>
              <span className="bakin-radius-chip" style={{ borderRadius: `var(${cssVar(token.path)})` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const meta = {
  title: 'Tokens/Spacing & Radius',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The public layout scale and corner radii, each bar and chip sized by its live custom property. Off-scale values are the exception, not the rule — compose layout with these steps.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Scale: Story = {
  render: () => <SpacingDoc />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Spacing & radius', level: 1 })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Layout scale' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Radii' })).toBeVisible()
  },
}
