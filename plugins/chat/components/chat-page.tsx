/**
 * Chat page — two-pane layout: chat list rail + active conversation.
 * URL state: ?chat=<chatId> (active chat), ?agent=<agentId> (list filter).
 */
import { Suspense } from 'react'
import { PluginHeader } from '@makinbakin/sdk/components'
import { useQueryState } from '@makinbakin/sdk/hooks'

import { ChatList } from './chat-list'
import { ChatView } from './chat-view'
import { useChats } from './use-chat-data'

function ChatPageInner() {
  const [chatId, setChatId] = useQueryState('chat', '')
  const [agentFilter, setAgentFilter] = useQueryState('agent', '')
  const { chats, refresh } = useChats(agentFilter)

  return (
    <div className="flex h-full flex-col">
      <PluginHeader title="Chat" count={chats.length} />
      <div className="flex min-h-0 flex-1">
        <ChatList
          chats={chats}
          selectedId={chatId}
          agentFilter={agentFilter}
          onSelect={setChatId}
          onAgentFilter={setAgentFilter}
          onChanged={() => { void refresh() }}
        />
        {chatId ? (
          <ChatView key={chatId} chatId={chatId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a chat or start a new one.
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  )
}
