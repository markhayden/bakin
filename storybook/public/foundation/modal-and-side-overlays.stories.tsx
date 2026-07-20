import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Modal and side overlays',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Dialog interrupts for a short decision or bounded task. Sheet preserves page context for inspection and editing. Both share focus trapping, return focus, busy dismissal, labelled close controls, portal containment, and reduced-motion behavior.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: function OverlayOverview() {
    const [dialogOpen, setDialogOpen] = useState(false)
    const [sheetOpen, setSheetOpen] = useState(false)
    return (
      <main className="bakin-primitive-story">
        <header className="bakin-primitive-story__intro">
          <p className="bakin-primitive-story__eyebrow">Foundation</p>
          <h1>Modal and side overlays</h1>
          <p>Choose by task shape: a short blocking decision belongs in a dialog; contextual inspection or editing belongs in a side overlay.</p>
        </header>
        <section className="bakin-primitive-story__section" aria-labelledby="overlay-choices-heading">
          <header><h2 id="overlay-choices-heading">Choose the smallest interruption</h2><p>Both examples preserve keyboard focus and expose an explicit close path.</p></header>
          <div className="bakin-primitive-story__grid">
            <article className="bakin-primitive-story__overlay-choice">
              <div><p className="bakin-primitive-story__label">Dialog</p><h3>Confirm a bounded decision</h3><p>Keep the title, consequence, and actions visible together.</p></div>
              <Button variant="outline" onClick={() => setDialogOpen(true)}>Open decision dialog</Button>
            </article>
            <article className="bakin-primitive-story__overlay-choice">
              <div><p className="bakin-primitive-story__label">Sheet</p><h3>Inspect contextual detail</h3><p>Use the available height without replacing the underlying route.</p></div>
              <Button variant="outline" onClick={() => setSheetOpen(true)}>Open task panel</Button>
            </article>
          </div>
        </section>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Publish workflow?</DialogTitle><DialogDescription>Publishing makes this version available to every assigned agent.</DialogDescription></DialogHeader>
            <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button>Publish workflow</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent>
            <SheetHeader><SheetTitle>Review task context</SheetTitle><SheetDescription>Task 842 · workflow handoff</SheetDescription></SheetHeader>
            <div className="bakin-primitive-story__overlay-body"><p>The task keeps its route context while detailed evidence and controls use the full panel height.</p></div>
            <SheetFooter><Button variant="outline" onClick={() => setSheetOpen(false)}>Done</Button></SheetFooter>
          </SheetContent>
        </Sheet>
      </main>
    )
  },
} satisfies Story
