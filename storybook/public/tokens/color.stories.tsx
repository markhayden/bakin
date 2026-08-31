import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { tokenLabel } from '../../support/token-label'
import { GENERATED_TOKENS } from '../../support/tokens.data'

const cssVar = (path: string) => `--bakin-${path.replace(/^semantic\./, '').replace(/\./g, '-')}`

const COLORS = GENERATED_TOKENS
  .filter((token) => token.type === 'color' && token.visibility === 'public' && token.layer === 'semantic')

const GROUPS = [...new Set(COLORS.map((token) => token.path.split('.')[2]))]

const CSS = `
.bakin-color-doc {
.bakin-token-label { display: block; font-size: .875rem; font-weight: 600; line-height: 1.2; margin-bottom: .125rem; }
 min-height: 100vh; background: var(--bakin-color-canvas-default); color: var(--bakin-color-text-primary); padding: var(--bakin-layout-space-8); font-family: var(--bakin-typography-family-ui); }
.bakin-color-doc__content { width: min(100%, 76rem); margin: 0 auto; }
.bakin-color-doc h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.75rem); line-height: 1; letter-spacing: -.045em; }
.bakin-color-doc__lede { max-width: 46rem; margin: var(--bakin-layout-space-3) 0 0; color: var(--bakin-color-text-muted); line-height: 1.65; }
.bakin-color-doc h2 { margin: var(--bakin-layout-space-8) 0 var(--bakin-layout-space-3); font-size: 1.125rem; text-transform: capitalize; }
.bakin-color-doc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bakin-layout-space-2); grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); }
.bakin-color-swatch { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr); gap: var(--bakin-layout-space-3); align-items: center; border: 1px solid var(--bakin-color-border-subtle); border-radius: var(--bakin-radius-control); padding: var(--bakin-layout-space-2); background: var(--bakin-color-surface-default); }
.bakin-color-swatch__chip { block-size: 3.25rem; border-radius: var(--bakin-radius-control); border: 1px solid var(--bakin-color-border-subtle); }
.bakin-color-swatch code { font-family: var(--bakin-typography-family-mono); font-size: .72rem; overflow-wrap: anywhere; display: block; }
.bakin-color-swatch p { margin: var(--bakin-layout-space-1) 0 0; color: var(--bakin-color-text-muted); font-size: .75rem; line-height: 1.4; }
.bakin-color-swatch small { color: var(--bakin-color-text-muted); font-size: .68rem; }
@media (max-width: 44rem) { .bakin-color-doc { padding: var(--bakin-layout-space-4); } }
`

function ColorDoc() {
  return (
    <div className="bakin-color-doc">
      <style>{CSS}</style>
      <div className="bakin-color-doc__content">
        <h1>Color</h1>
        <p className="bakin-color-doc__lede">
          Every public semantic color token, rendered from the live custom property so the specimen
          cannot drift from the shipped stylesheet. Contrast ratios come from the token pipeline.
        </p>
        {GROUPS.map((group) => (
          <section key={group} aria-label={group}>
            <h2>{group}</h2>
            <ul>
              {COLORS.filter((token) => token.path.split('.')[2] === group).map((token) => (
                <li key={token.path} className="bakin-color-swatch" aria-label={token.path}>
                  <span className="bakin-color-swatch__chip" style={{ background: `var(${cssVar(token.path)})` }} aria-hidden="true" />
                  <span>
                    <strong className="bakin-token-label">{tokenLabel(token.path)}</strong>
                    <code>{cssVar(token.path)}</code>
                    {token.description ? <p>{token.description}</p> : null}
                    {token.contrast ? (
                      <small>
                        {token.contrast.ratio.toFixed(2)}:1 · {token.contrast.standard} · {token.contrast.status}
                      </small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

const meta = {
  title: 'Tokens/Color',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The public semantic color vocabulary. Swatches paint from the live `--bakin-color-*` custom properties; use tokens, never raw palette values. Contrast data is produced by the token pipeline and shown per pairing.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Palette: Story = {
  render: () => <ColorDoc />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Color', level: 1 })).toBeVisible()
    await expect(canvas.getByText('--bakin-color-action-primary-background')).toBeVisible()
    await expect(canvas.getByText('--bakin-color-text-muted')).toBeVisible()
  },
}
