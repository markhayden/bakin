/**
 * Start-a-chat agent picker — a friendly popover of agents (avatar + name),
 * replacing the old "New chat with…" select.
 */
import { useState } from 'react'
import { MessageCirclePlus } from 'lucide-react'
import { useAgentList } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/patterns'
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'

export function AgentPicker({
  onPick,
  iconOnly = false,
}: {
  onPick: (agentId: string) => void
  /** Icon-only trigger (the rail); default is the outline button with label. */
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const agents = useAgentList()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={(
            <PopoverTrigger
              render={<Button variant="primary" size={iconOnly ? 'icon-md' : 'md'} />}
              data-chat-start
              aria-label="Start a chat"
              aria-keyshortcuts="Meta+Shift+O"
            />
          )}
        >
          <MessageCirclePlus />
          {iconOnly ? null : 'Start a chat'}
        </TooltipTrigger>
        <TooltipContent>
          Start a chat <CommandShortcut>⌘⇧O</CommandShortcut>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="p-0" align="start">
        <Command>
          {agents.length > 6 ? <CommandInput placeholder="Find an agent…" /> : null}
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            <CommandGroup heading="Start a chat with…">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.name} ${agent.id} ${agent.role ?? ''}`}
                  onSelect={() => {
                    setOpen(false)
                    onPick(agent.id)
                  }}
                >
                  <AgentAvatar
                    agent={{ id: agent.id, name: agent.name || agent.id, imageSrc: agent.headshot || null }}
                    size="xs"
                    decorative
                  />
                  <span className="ml-bakin-2 min-w-0">
                    <span className="block truncate">{agent.name || agent.id}</span>
                    {agent.role ? (
                      <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">{agent.role}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
