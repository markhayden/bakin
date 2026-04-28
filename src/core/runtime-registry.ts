import type { AgentRuntimeAdapter, ChatChunk, RuntimeMetadata, ToolResult } from '@bakin/core/adapters/runtime'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { maybeGetAppServices } from './app-services'

type RuntimeGlobal = typeof globalThis & {
  __bakinFallbackRuntimeAdapter?: AgentRuntimeAdapter
  __bakinAgentLastReply?: Map<string, number>
}

const runtimeGlobal = globalThis as RuntimeGlobal

const lastReply: Map<string, number> = (runtimeGlobal.__bakinAgentLastReply ??= new Map())

export function getRuntimeAdapter(): AgentRuntimeAdapter {
  const services = maybeGetAppServices()
  if (services?.runtime) return services.runtime
  runtimeGlobal.__bakinFallbackRuntimeAdapter ??= createMockRuntimeAdapter({
    name: 'fallback-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
  })
  return runtimeGlobal.__bakinFallbackRuntimeAdapter
}

async function sendRuntimeMessage(
  agentId: string,
  content: string,
  opts: { threadId?: string; metadata?: RuntimeMetadata } = {},
): Promise<string> {
  const result = await getRuntimeAdapter().messaging.send({
    agentId,
    content,
    threadId: opts.threadId,
    metadata: opts.metadata,
  })
  const reply = result.content ?? ''
  if (reply.trim().length > 0) lastReply.set(agentId, Date.now())
  return reply
}

export function streamAgentMessage(args: {
  agentId: string
  content: string
  threadId?: string
  metadata?: RuntimeMetadata
}): AsyncIterable<ChatChunk> {
  return getRuntimeAdapter().messaging.stream(args)
}

export interface RuntimeChatOpts {
  agentId: string
  messages: Array<{ role: string; content: string }>
  sessionKey?: string
  signal?: AbortSignal
  model?: string
  maxTokens?: number
}

export async function chatAgentCompletion(opts: RuntimeChatOpts): Promise<string> {
  void opts.signal
  return sendRuntimeMessage(opts.agentId, flattenChatMessages(opts.messages), {
    threadId: opts.sessionKey,
    metadata: { model: opts.model, maxTokens: opts.maxTokens },
  })
}

export async function streamAgentMessageResponse(opts: RuntimeChatOpts): Promise<Response> {
  void opts.signal
  const chunks = getRuntimeAdapter().messaging.stream({
    agentId: opts.agentId,
    content: flattenChatMessages(opts.messages),
    threadId: opts.sessionKey,
    metadata: { model: opts.model, maxTokens: opts.maxTokens },
  })
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of chunks) {
          if (chunk.type === 'text' && chunk.content) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk.content } }] })}\n\n`))
          } else if (chunk.type === 'error') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: chunk.content ?? 'Runtime stream error' })}\n\n`))
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export async function invokeRuntimeTool(
  agentId: string,
  name: string,
  args: unknown
): Promise<ToolResult> {
  return getRuntimeAdapter().tools.invoke(agentId, name, args)
}

export async function restartRuntime(): Promise<void> {
  await getRuntimeAdapter().restart()
}

export async function pingRuntime(): Promise<boolean> {
  return getRuntimeAdapter().ping()
}

export function getAgentLastReply(agentId: string): number | null {
  return lastReply.get(agentId) ?? null
}

function flattenChatMessages(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 1) return messages[0].content
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n')
}
