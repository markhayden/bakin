import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Selection controls',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Checkbox chooses independent items, Switch changes an immediate binary setting, and Select chooses from a bounded option list. All three retain native form semantics, 24px minimum targets, explicit labels, and the same invalid, disabled, and focus language.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: function SelectionOverview() {
    const [digest, setDigest] = useState(true)
    return (
      <main className="bakin-primitive-story">
        <header className="bakin-primitive-story__intro">
          <p className="bakin-primitive-story__eyebrow">Foundation</p>
          <h1>Selection controls</h1>
          <p>Three distinct interaction models share one consistent state, target, and option vocabulary.</p>
        </header>

        <section className="bakin-primitive-story__section" aria-labelledby="selection-checkbox-heading">
          <header><h2 id="selection-checkbox-heading">Independent choices</h2><p>Use Checkbox when each choice can stand on its own or when several items may be selected.</p></header>
          <div className="bakin-primitive-story__selection-stack">
            <div className="bakin-primitive-story__selection-row"><Checkbox id="overview-index" defaultChecked /><div><Label htmlFor="overview-index">Index new assets automatically</Label><p>Runs after each successful source sync.</p></div></div>
            <div className="bakin-primitive-story__selection-row"><Checkbox id="overview-mixed" indeterminate /><div><Label htmlFor="overview-mixed">Apply to selected workspaces</Label><p>Three of seven workspaces are currently included.</p></div></div>
            <div className="bakin-primitive-story__selection-row"><Checkbox id="overview-invalid" required aria-invalid="true" /><div><Label htmlFor="overview-invalid">I reviewed the destructive changes</Label><p className="bakin-primitive-story__error">Required before applying this plan.</p></div></div>
            <div className="bakin-primitive-story__selection-row"><Checkbox id="overview-disabled" disabled /><div><Label htmlFor="overview-disabled">Mirror protected runtime metadata with its complete long-form policy label</Label><p>Managed by the organization policy.</p></div></div>
          </div>
        </section>

        <section className="bakin-primitive-story__section" aria-labelledby="selection-switch-heading">
          <header><h2 id="selection-switch-heading">Immediate settings</h2><p>Use Switch when changing the value takes effect immediately rather than joining a later form submission.</p></header>
          <div className="bakin-primitive-story__selection-stack">
            <div className="bakin-primitive-story__selection-row"><Switch id="overview-digest" checked={digest} onCheckedChange={setDigest} /><div><Label htmlFor="overview-digest">Daily approval digest</Label><p role="status">{digest ? 'Enabled · delivered at 08:00' : 'Disabled'}</p></div></div>
            <div className="bakin-primitive-story__selection-row"><Switch id="overview-switch-disabled" disabled /><div><Label htmlFor="overview-switch-disabled">Automatic external publishing</Label><p>Unavailable until a publisher is connected.</p></div></div>
          </div>
        </section>

        <section className="bakin-primitive-story__section" aria-labelledby="selection-select-heading">
          <header><h2 id="selection-select-heading">One bounded option</h2><p>Long values wrap in the popup while the trigger remains contained.</p></header>
          <div className="bakin-primitive-story__form-grid">
            <div className="bakin-primitive-story__field">
              <Label id="overview-runtime-label">Execution runtime</Label>
              <Select items={{ pi: 'Pi', openclaw: 'OpenClaw', managed: 'Managed production runtime with an intentionally long descriptive option' }} defaultValue="openclaw">
                <SelectTrigger aria-labelledby="overview-runtime-label" className="bakin-primitive-story__selection-trigger"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup><SelectLabel>Local</SelectLabel><SelectItem value="pi">Pi</SelectItem><SelectItem value="openclaw">OpenClaw</SelectItem></SelectGroup>
                  <SelectSeparator />
                  <SelectGroup><SelectLabel>Managed</SelectLabel><SelectItem value="managed">Managed production runtime with an intentionally long descriptive option</SelectItem></SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="bakin-primitive-story__field">
              <Label id="overview-owner-label">Fallback owner</Label>
              <Select items={{ '': 'No fallback owner', research: 'Research operations', publishing: 'Publishing · unavailable' }} required>
                <SelectTrigger aria-labelledby="overview-owner-label" aria-invalid="true" aria-describedby="overview-owner-error" className="bakin-primitive-story__selection-trigger"><SelectValue placeholder="Choose an owner" /></SelectTrigger>
                <SelectContent><SelectItem value="">No fallback owner</SelectItem><SelectItem value="research">Research operations</SelectItem><SelectItem value="publishing" disabled>Publishing · unavailable</SelectItem></SelectContent>
              </Select>
              <p className="bakin-primitive-story__error" id="overview-owner-error">Choose an owner before saving.</p>
            </div>
          </div>
        </section>
      </main>
    )
  },
} satisfies Story
