/**
 * Start-a-chat agent picker — a friendly popover of agents (avatar + name),
 * replacing the old "New chat with…" select.
 */
import { useState } from 'react'
import { MessageCirclePlus } from 'lucide-react'
import { AgentAvatar } from '@makinbakin/sdk/components'
import { useAgentList } from '@makinbakin/sdk/hooks'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@makinbakin/sdk/ui'

export function AgentPicker({
  onPick,
  compact = false,
}: {
  onPick: (agentId: string) => void
  /** Compact header-action styling instead of the full-width rail button. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const agents = useAgentList()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-chat-start
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent'
            : 'inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90'
        }
      >
        <MessageCirclePlus className="size-4" /> Start a chat
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          {agents.length > 6 ? <CommandInput placeholder="Find an agent…" /> : null}
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            <CommandGroup heading="Start a chat with…">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.name} ${agent.id}`}
                  onSelect={() => {
                    setOpen(false)
                    onPick(agent.id)
                  }}
                >
                  <AgentAvatar agentId={agent.id} size="xs" />
                  <span className="ml-2 truncate">{agent.name || agent.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
