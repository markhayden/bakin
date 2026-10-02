import { useState } from 'react'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { PageHeader, WorkspacePage, WorkspacePageBody, WorkspacePageHeader, WorkspacePageCompactHeader } from '@makinbakin/sdk/patterns'
import { Button, Textarea, Text } from '@makinbakin/sdk/ui'

export function WorkspaceInputFixture() {
  const [value, setValue] = useState('Write a note here.')
  return <div className="h-dvh">
    <WorkspacePage viewport="visual" mode="immersive">
      <WorkspacePageHeader><PageHeader title="Workspace notes" /></WorkspacePageHeader>
      <WorkspacePageCompactHeader title="Workspace notes" />
      <WorkspacePageBody inputAccessory={
        <Inline gap="dense" className="border-t border-bakin-border-subtle bg-bakin-canvas-default p-bakin-3">
          <Button size="lg" variant="outline" onMouseDown={event => event.preventDefault()} onClick={() => setValue(current => current + ' ✓')}>Complete</Button>
          <Text size="meta" tone="muted">Controls reserve space below the editor.</Text>
        </Inline>
      }>
        <Stack gap="none" className="min-h-0 flex-1 p-bakin-3">
          <Textarea aria-label="Workspace note" value={value} onChange={event => setValue(event.target.value)} className="min-h-0 flex-1" />
        </Stack>
      </WorkspacePageBody>
    </WorkspacePage>
  </div>
}
