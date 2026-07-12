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
      <PopoverTrigger
        data-chat-start
        aria-label="Start a chat"
        title="Start a chat (⌘⇧O)"
        className={
          iconOnly
            ? 'inline-flex items-center justify-center rounded-md bg-primary p-2 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90'
            : 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/10'
        }
      >
        <MessageCirclePlus className="size-4" />
        {iconOnly ? null : 'Start a chat'}
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
                  value={`${agent.name} ${agent.id} ${agent.role ?? ''}`}
                  onSelect={() => {
                    setOpen(false)
                    onPick(agent.id)
                  }}
                >
                  <AgentAvatar agentId={agent.id} size="xs" />
                  <span className="ml-2 min-w-0">
                    <span className="block truncate">{agent.name || agent.id}</span>
                    {agent.role ? (
                      <span className="block truncate text-xs text-muted-foreground">{agent.role}</span>
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
