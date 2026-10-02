import { useId, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { Inline, Panel, Stack } from '@makinbakin/sdk/layout'
import { WorkspacePage, WorkspacePageBody } from '@makinbakin/sdk/patterns'
import { Button, Text, Textarea } from '@makinbakin/sdk/ui'

const editing = ['Enter', 'Backspace', 'Delete', 'Shift+Tab', 'Home', 'End', 'Page Up', 'Page Down']
const shortcuts = ['C', 'D', 'Z', 'R', 'L', 'A', 'E', 'U', 'K', 'W']

/** Public composition example: callbacks use key names, never terminal bytes. */
export function TerminalInputFixture() {
  const [expanded, setExpanded] = useState(false)
  const [ctrl, setCtrl] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [lastKey, setLastKey] = useState('No key sent')
  const panelId = useId()
  const send = (key: string) => { setLastKey(ctrl ? `Ctrl+${key}` : key); setCtrl(false) }
  // Prevent the mouse focus default (also synthesized after a touch tap),
  // while leaving touch scrolling, click activation and keyboard focus alone.
  const preserveFocus = (event: React.MouseEvent) => event.preventDefault()
  return <div className="h-dvh">
    <WorkspacePage viewport="visual">
      <WorkspacePageBody inputAccessory={
        <Stack gap="dense" className="border-t border-bakin-border-subtle bg-bakin-canvas-default p-bakin-3" role="group" aria-label="Terminal keys">
          {expanded && <Panel id={panelId} scroll padding="compact" aria-label="More terminal keys" className="max-h-[min(12rem,calc(var(--bakin-workspace-viewport-height,100dvh)*0.2))]">
            <Inline gap="dense">
              {editing.map(key => <Button key={key} size="lg" variant="outline" disabled={disabled} onMouseDown={preserveFocus} onClick={() => send(key)}>{key}</Button>)}
              {shortcuts.map(key => <Button key={key} size="lg" variant="outline" disabled={disabled} onMouseDown={preserveFocus} onClick={() => { setCtrl(false); setLastKey(`Ctrl+${key}`) }}>Ctrl+{key}</Button>)}
            </Inline>
          </Panel>}
          <Inline gap="dense" justify="between">
            <Inline gap="dense" role="group" aria-label="Modifiers and completion">
              {['Esc', 'Tab'].map(key => <Button key={key} size="lg" variant="outline" disabled={disabled} onMouseDown={preserveFocus} onClick={() => send(key)}>{key}</Button>)}
              <Button size="lg" variant={ctrl ? 'primary' : 'outline'} aria-pressed={ctrl} disabled={disabled} onMouseDown={preserveFocus} onClick={() => setCtrl(value => !value)}>Ctrl</Button>
              <Button size="lg" variant="outline" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onMouseDown={preserveFocus} onClick={() => setExpanded(value => !value)}>More</Button>
            </Inline>
            <Inline gap="dense" role="group" aria-label="Cursor keys">
              {([['Left', ArrowLeft], ['Down', ArrowDown], ['Up', ArrowUp], ['Right', ArrowRight]] as const).map(([key, Icon]) => <Button key={key} size="icon-lg" variant="outline" aria-label={key} disabled={disabled} onMouseDown={preserveFocus} onClick={() => send(key)}><Icon aria-hidden="true" /></Button>)}
            </Inline>
          </Inline>
        </Stack>
      }>
        <Stack gap="item" className="min-h-0 flex-1 overflow-y-auto p-bakin-3">
          <Text as="h1" weight="semibold">Terminal input</Text>
          <Button variant="outline" onClick={() => { setDisabled(value => !value); setCtrl(false) }}>{disabled ? 'Enable keys' : 'Disable keys'}</Button>
          <Textarea aria-label="Example input" defaultValue="Try completion and cursor movement." className="min-h-0 flex-1" />
          <Text role="status">{lastKey}</Text>
        </Stack>
      </WorkspacePageBody>
    </WorkspacePage>
  </div>
}
