import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { tokenLabel } from '../../support/token-label'
import { GENERATED_TOKENS } from '../../support/tokens.data'

const cssVar = (path: string) => `--bakin-${path.replace(/^semantic\./, '').replace(/\./g, '-')}`
const pub = GENERATED_TOKENS.filter((token) => token.visibility === 'public' && token.layer === 'semantic')
const SIZES = pub.filter((token) => token.type === 'dimension' && token.path.includes('typography.size'))
const WEIGHTS = pub.filter((token) => token.type === 'fontWeight')
const FAMILIES = pub.filter((token) => token.type === 'fontFamily')

const CSS = `
.bakin-type-doc {
.bakin-token-label { display: block; font-size: .875rem; font-weight: 600; line-height: 1.2; margin-bottom: .125rem; }
 min-height: 100vh; background: var(--bakin-color-canvas-default); color: var(--bakin-color-text-primary); padding: var(--bakin-layout-space-8); font-family: var(--bakin-typography-family-ui); }
.bakin-type-doc__content { width: min(100%, 64rem); margin: 0 auto; }
.bakin-type-doc h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1; letter-spacing: -.045em; }
.bakin-type-doc h2 { margin: var(--bakin-layout-space-8) 0 var(--bakin-layout-space-3); font-size: 1.125rem; }
.bakin-type-doc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bakin-layout-space-4); }
.bakin-type-row { display: grid; gap: var(--bakin-layout-space-1); }
.bakin-type-row code { font-family: var(--bakin-typography-family-mono); font-size: .72rem; color: var(--bakin-color-text-muted); overflow-wrap: anywhere; }
.bakin-type-row p { margin: 0; }
@media (max-width: 44rem) { .bakin-type-doc { padding: var(--bakin-layout-space-4); } }
`

const SAMPLE = 'Dispatch resumes after the gate approves.'

function TypographyDoc() {
  return (
    <div className="bakin-type-doc">
      <style>{CSS}</style>
      <div className="bakin-type-doc__content">
        <h1>Typography</h1>
        <h2>Sizes</h2>
        <ul>
          {SIZES.map((token) => (
            <li key={token.path} className="bakin-type-row" aria-label={token.path}>
              <span>
                <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                <code>{cssVar(token.path)}</code>
              </span>
              <p style={{ fontSize: `var(${cssVar(token.path)})` }}>{SAMPLE}</p>
            </li>
          ))}
        </ul>
        <h2>Weights</h2>
        <ul>
          {WEIGHTS.map((token) => (
            <li key={token.path} className="bakin-type-row" aria-label={token.path}>
              <span>
                <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                <code>{cssVar(token.path)}</code>
              </span>
              <p style={{ fontWeight: `var(${cssVar(token.path)})` as never }}>{SAMPLE}</p>
            </li>
          ))}
        </ul>
        <h2>Families</h2>
        <ul>
          {FAMILIES.map((token) => (
            <li key={token.path} className="bakin-type-row" aria-label={token.path}>
              <span>
                <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                <code>{cssVar(token.path)}</code>
              </span>
              <p style={{ fontFamily: `var(${cssVar(token.path)})` }}>{SAMPLE}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const meta = {
  title: 'Tokens/Typography',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The public type scale, weights, and families, each specimen set in its live custom property. Bare headings take the scale from the stylesheet; body text composes the Text primitive.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Scale: Story = {
  render: () => <TypographyDoc />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Typography', level: 1 })).toBeVisible()
    await expect(canvas.getByText('--bakin-typography-size-body')).toBeVisible()
    await expect(canvas.getByText('--bakin-typography-family-mono')).toBeVisible()
  },
}
