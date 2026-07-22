import type { Meta, StoryObj } from '@storybook/react-vite'
import { PluginOwnershipRoot } from '@makinbakin/sdk/internal'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Toast,
  ToastRegion,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import '../public/foundation/primitives.stories.css'
import './plugin-containment.stories.css'

const meta = {
  title: 'Maintainer/Plugin containment',
  tags: ['internal'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The host automatically preserves plugin ownership when SDK overlays portal outside a page or slot. The ownership wrapper in this fixture is host-only plumbing—plugin authors use the normal Dialog, Popover, Tooltip, menu, and selection APIs without supplying a portal container.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function PluginOverlayFixture({
  pluginId,
  label,
}: {
  pluginId: 'fixture-alpha' | 'fixture-bravo'
  label: 'Alpha' | 'Bravo'
}) {
  return (
    <PluginOwnershipRoot pluginId={pluginId}>
      <article className="bakin-plugin-containment__plugin">
        <div>
          <p className="bakin-primitive-story__eyebrow">{label} plugin</p>
          <h2>{label} operations</h2>
          <p>Both fixtures intentionally reuse the same domain class and custom-property name.</p>
        </div>
        <div className="bakin-primitive-story__cluster">
          <Popover defaultOpen>
            <PopoverTrigger render={<Button variant="outline" />}>Inspect {label}</PopoverTrigger>
            <PopoverContent
              align="start"
              className="bakin-plugin-containment__domain-overlay"
              data-plugin-containment-overlay={pluginId}
            >
              <PopoverHeader>
                <PopoverTitle>{label} context</PopoverTitle>
                <PopoverDescription>This portalled panel retains {label}&apos;s scoped domain value.</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Open {label} dialog</DialogTrigger>
            <DialogContent
              className="bakin-plugin-containment__domain-overlay"
              data-plugin-containment-dialog={pluginId}
            >
              <DialogHeader>
                <DialogTitle>{label} decision</DialogTitle>
                <DialogDescription>The dialog remains inside the {label} ownership contract.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <TooltipProvider delay={0}>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" />}>Explain {label}</TooltipTrigger>
              <TooltipContent
                className="bakin-plugin-containment__domain-overlay"
                data-plugin-containment-tooltip={pluginId}
              >
                {label} supplemental context
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </article>
    </PluginOwnershipRoot>
  )
}

export const TwoPluginOverlays = {
  render: () => (
    <main className="bakin-primitive-story bakin-plugin-containment">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Runtime isolation</p>
        <h1>Plugin styles stop at their ownership boundary</h1>
        <p>Portalled UI keeps the same plugin identity as its page or slot, while shell notifications stay host-owned.</p>
      </header>
      <section className="bakin-plugin-containment__plugins" aria-label="Independent plugin fixtures">
        <PluginOverlayFixture pluginId="fixture-alpha" label="Alpha" />
        <PluginOverlayFixture pluginId="fixture-bravo" label="Bravo" />
      </section>
      <ToastRegion label="Host notifications" className="bakin-plugin-containment__toasts">
        <Toast tone="success" title="Alpha completed" description="The shell owns this notification presentation." />
        <Toast tone="info" title="Bravo updated" description="Plugin domain CSS cannot leak into the host toast region." />
      </ToastRegion>
    </main>
  ),
  play: async () => {
    const page = within(document.body)
    await waitFor(() => expect(page.getByText('Alpha context', { exact: true })).toBeVisible())
    await waitFor(() => expect(page.getByText('Bravo context', { exact: true })).toBeVisible())

    const overlays = document.querySelectorAll<HTMLElement>('[data-plugin-containment-overlay]')
    expect(overlays).toHaveLength(2)
    expect(overlays[0]?.closest('[data-bakin-plugin-portal]')).toHaveAttribute('data-bakin-plugin', 'fixture-alpha')
    expect(overlays[1]?.closest('[data-bakin-plugin-portal]')).toHaveAttribute('data-bakin-plugin', 'fixture-bravo')
    expect(getComputedStyle(overlays[0]!).borderInlineStartColor)
      .not.toBe(getComputedStyle(overlays[1]!).borderInlineStartColor)
    expect(page.getByRole('region', { name: 'Host notifications' }).closest('[data-bakin-plugin]')).toBeNull()
  },
} satisfies Story
