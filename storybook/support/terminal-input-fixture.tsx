import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Ellipsis, KeyboardOff, Lock } from 'lucide-react'
import { Inline, Panel, Stack } from '@makinbakin/sdk/layout'
import { WorkspacePage, WorkspacePageBody } from '@makinbakin/sdk/patterns'
import { Button, Text, Textarea } from '@makinbakin/sdk/ui'

type Modifier = 'ctrl' | 'alt'
type ModifierState = 'off' | 'once' | 'locked'
const NAMES: Record<Modifier, string> = { ctrl: 'Control', alt: 'Option' }
const FACES: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥' }
const PREFIXES: Record<Modifier, string> = { ctrl: 'Ctrl+', alt: 'Alt+' }
const sheetKeys = ['Esc', 'Tab', 'Shift+Tab', 'Enter', 'Left', 'Down', 'Up', 'Right', 'Home', 'End', 'Page Up', 'Page Down', 'Backspace', 'Delete', '|', '~', '/', '-']
const controls = [['C', 'Interrupt'], ['D', 'End input'], ['R', 'Search history'], ['L', 'Clear screen'], ['A', 'Line start'], ['E', 'Line end'], ['U', 'Delete line'], ['W', 'Delete word'], ['K', 'Delete to end'], ['Z', 'Suspend']] as const
const arrows = [['Left', ArrowLeft], ['Down', ArrowDown], ['Up', ArrowUp], ['Right', ArrowRight]] as const
/** Named keys a keyboard delivers to the editor, by the names the row and sheet use. */
const namedKeys: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Esc' }

/** A modifier's spoken name says its state; the lock is also shown by shape, not colour alone. */
function modifierLabel(modifier: Modifier, state: ModifierState): string {
  return state === 'locked' ? `${NAMES[modifier]}, locked` : state === 'once' ? `${NAMES[modifier]}, on for the next key` : NAMES[modifier]
}

/** Public composition example: callbacks use key names, never terminal bytes. */
export function TerminalInputFixture() {
  const [sheet, setSheet] = useState(false)
  const [modifiers, setModifiers] = useState<Record<Modifier, ModifierState>>({ ctrl: 'off', alt: 'off' })
  const [disabled, setDisabled] = useState(false)
  const [lastKey, setLastKey] = useState('No key sent')
  const editor = useRef<HTMLTextAreaElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // One key takes the modifiers (a Control shortcut adds Control once) and consumes a one-shot one; a lock stays.
  const send = (key: string, control = false) => {
    setLastKey((['ctrl', 'alt'] as const).filter(modifier => modifiers[modifier] !== 'off' || (modifier === 'ctrl' && control)).map(modifier => PREFIXES[modifier]).join('') + key)
    setModifiers(current => ({ ctrl: current.ctrl === 'once' ? 'off' : current.ctrl, alt: current.alt === 'once' ? 'off' : current.alt }))
  }
  const tap = (modifier: Modifier) => setModifiers(current => ({ ...current, [modifier]: current[modifier] === 'off' ? 'once' : 'off' }))
  const toggleLock = (modifier: Modifier) => setModifiers(current => ({ ...current, [modifier]: current[modifier] === 'locked' ? 'off' : 'locked' }))
  const backToKeyboard = () => { setSheet(false); editor.current?.focus() }
  // While the sheet is open it owns Escape, wherever focus is: it closes the
  // sheet and never reaches the editor (captured first). Left alone: an
  // Escape inside an open dialog (the dialog's), inside a composition, or
  // one another owner already claimed.
  useEffect(() => {
    if (!sheet) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return
      event.preventDefault()
      event.stopPropagation()
      setSheet(false)
      editor.current?.focus()
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [sheet])
  const active = modifiers.ctrl !== 'off' || modifiers.alt !== 'off'
  // The next key delivered to the editor takes an armed or locked modifier; committed
  // text (IME, dictation, autocorrect) is sent as typed and ends a one-shot one.
  // Simplified: a terminal consumer encodes every delivered key and chunk itself.
  const editorKey = (event: React.KeyboardEvent) => {
    if (!active || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    const name = event.key.length === 1 ? event.key : namedKeys[event.key]
    if (!name) return
    event.preventDefault()
    send(name)
  }
  const endOnce = () => setModifiers(current => ({ ctrl: current.ctrl === 'once' ? 'off' : current.ctrl, alt: current.alt === 'once' ? 'off' : current.alt }))
  // Committed text only: not the interim input of a composition, nor one that was cancelled.
  const editorInput = (event: React.FormEvent) => { if (!(event.nativeEvent as InputEvent).isComposing) endOnce() }
  const editorCommit = (event: React.CompositionEvent) => { if (event.data) endOnce() }
  const openSheet = (event: React.MouseEvent) => {
    setSheet(true)
    // The sheet stands in for the software keyboard, which goes down: focus
    // leaves the editor for the sheet (not an input, so no keyboard), where
    // Escape closes it. Opened from a keyboard, focus goes to its first key.
    requestAnimationFrame(() => (event.detail === 0 && sheetRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') || sheetRef.current)?.focus())
  }
  // Prevent the mouse focus default (also synthesized after a touch tap),
  // while leaving touch scrolling, click activation and keyboard focus alone.
  const preserveFocus = (event: React.MouseEvent) => event.preventDefault()
  const key = (name: string, label = name, face: React.ReactNode = name) => <Button key={name} size="lg" variant="secondary" aria-label={label} disabled={disabled} onMouseDown={preserveFocus} onClick={() => send(name)}>{face}</Button>
  // The row's keys are square 44px caps with keycap faces: six fit a 320px screen.
  const rowKey = (name: string, face: string) => <Button key={name} size="icon-lg" variant="secondary" aria-label={name} disabled={disabled} onMouseDown={preserveFocus} onClick={() => send(name)}>{face}</Button>
  const modifier = (name: Modifier) => <Button key={name} size="icon-lg" variant={modifiers[name] === 'off' ? 'secondary' : 'primary'} aria-label={modifierLabel(name, modifiers[name])}
    aria-pressed={modifiers[name] !== 'off'} disabled={disabled} onMouseDown={preserveFocus} onClick={() => tap(name)}>
    {FACES[name]}{modifiers[name] === 'locked' && <Lock aria-hidden="true" className="size-bakin-3" />}
  </Button>
  return <div className="h-dvh">
    <WorkspacePage viewport="visual">
      <WorkspacePageBody inputAccessory={
        <Stack gap="dense" className="border-t border-bakin-border-subtle bg-bakin-canvas-default px-bakin-2 py-bakin-3">
          <Inline gap="dense" role="group" aria-label="Terminal keys">
            {rowKey('Esc', 'esc')}
            {rowKey('Tab', '⇥')}
            {modifier('ctrl')}
            {modifier('alt')}
            {sheet
              ? <Button size="icon-lg" variant="ghost" className="ms-auto" onMouseDown={preserveFocus} onClick={backToKeyboard} aria-label="Back to keyboard">abc</Button>
              : <Button size="icon-lg" variant="ghost" className="ms-auto" onMouseDown={preserveFocus} onClick={openSheet} aria-label="More keys"><Ellipsis aria-hidden="true" /></Button>}
            <Button size="icon-lg" variant="ghost" aria-label="Hide keyboard" onMouseDown={preserveFocus} onClick={() => { setSheet(false); editor.current?.blur(); setLastKey('Keyboard hidden') }}><KeyboardOff aria-hidden="true" /></Button>
          </Inline>
          {sheet && <Panel ref={sheetRef} scroll padding="compact" role="region" aria-label="More keys" tabIndex={-1} className="max-h-[min(16rem,calc(var(--bakin-workspace-viewport-height,100dvh)*0.4))]">
            <Stack gap="dense">
              <Inline gap="dense" role="group" aria-label="Keys">
                {sheetKeys.map(name => {
                  const arrow = arrows.find(([direction]) => direction === name)
                  if (!arrow) return key(name)
                  const Icon = arrow[1]
                  return key(name, name, <Icon aria-hidden="true" />)
                })}
              </Inline>
              <Inline gap="dense" role="group" aria-label="Control">
                {controls.map(([letter, label]) => <Button key={letter} size="lg" variant="secondary" aria-label={`Ctrl+${letter} ${label}`} disabled={disabled} onMouseDown={preserveFocus}
                  onClick={() => send(letter, true)}>
                  ^{letter} <Text as="span" tone="muted">{label}</Text>
                </Button>)}
              </Inline>
              <Inline gap="dense" role="group" aria-label="Locks">
                {(['ctrl', 'alt'] as const).map(name => <Button key={name} size="lg" variant={modifiers[name] === 'locked' ? 'primary' : 'secondary'} aria-label={`${NAMES[name]} lock`}
                  aria-pressed={modifiers[name] === 'locked'} disabled={disabled} onMouseDown={preserveFocus} onClick={() => toggleLock(name)}>
                  <Lock aria-hidden="true" />{FACES[name]} {NAMES[name]} lock
                </Button>)}
              </Inline>
            </Stack>
          </Panel>}
        </Stack>
      }>
        <Stack gap="item" className="min-h-0 flex-1 overflow-y-auto p-bakin-3">
          <Text as="h1" weight="semibold">Terminal input</Text>
          <Button variant="outline" onClick={() => { setDisabled(value => !value); setModifiers({ ctrl: 'off', alt: 'off' }) }}>{disabled ? 'Enable keys' : 'Disable keys'}</Button>
          <Textarea ref={editor} aria-label="Example input" defaultValue="Try completion and cursor movement." className="min-h-0 flex-1" onKeyDown={editorKey} onInput={editorInput} onCompositionEnd={editorCommit} />
          <Text role="status">{lastKey}</Text>
        </Stack>
      </WorkspacePageBody>
    </WorkspacePage>
  </div>
}
