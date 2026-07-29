/**
 * Representative Bakin-owned chats for visual review of the launcher, rail,
 * transcript, attachments, tool calls, and failure states.
 */
import { cpSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import type { ChatSummary, ChatTranscriptRow } from '../../plugins/chat/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ATTACHMENT_FIXTURE = join(
  __dirname,
  'fixtures',
  'asset-files',
  '20260404-sunrise-smoothie-c5d6e7f8.jpg',
)

const HOUR = 3_600_000

function timestamp(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * HOUR).toISOString()
}

interface SeedChat {
  summary: ChatSummary
  rows: ChatTranscriptRow[]
}

export function seedChats(mockHome: string): void {
  const chatRoot = join(mockHome, 'chat')
  const attachmentName = 'sunrise-smoothie-direction.jpg'
  const pixelChatId = '00000000-0000-4000-8000-000000000002'
  const pixelAttachmentDir = join(chatRoot, 'attachments', pixelChatId)
  const pixelAttachmentPath = join(pixelAttachmentDir, attachmentName)

  const chats: SeedChat[] = [
    {
      summary: {
        id: '00000000-0000-4000-8000-000000000001',
        agentId: 'main',
        title: 'Launch plan decisions',
        titleSource: 'llm',
        pinned: true,
        createdAt: timestamp(30),
        updatedAt: timestamp(1.2),
        messageCount: 4,
        unreadCount: 0,
        lastSeenAt: timestamp(1),
        lastMessageAt: timestamp(1.2),
        lastMessagePreview: 'I turned those decisions into a concise launch checklist.',
        markerEra: true,
      },
      rows: [
        {
          kind: 'user',
          ts: timestamp(30),
          content: 'Pull together the launch decisions from our latest tasks and call out anything still blocked.',
        },
        {
          kind: 'tool',
          ts: timestamp(29.9),
          turnId: 'turn-launch-1',
          callId: 'call-launch-tasks',
          toolName: 'bakin_exec_tasks_list',
          status: 'completed',
          summary: 'Reviewed 18 tasks across the launch board',
          durationMs: 184,
        },
        {
          kind: 'assistant',
          ts: timestamp(29.8),
          turnId: 'turn-launch-1',
          content: [
            'The launch is close. Three decisions still need an owner:',
            '',
            '- Approve the final campaign image direction.',
            '- Confirm the publishing window.',
            '- Decide whether the fallback model is acceptable for overnight work.',
          ].join('\n'),
        },
        { kind: 'done', ts: timestamp(29.8), turnId: 'turn-launch-1' },
        {
          kind: 'user',
          ts: timestamp(1.4),
          content: 'The image and publishing window are approved. Give me the cleaned-up checklist.',
        },
        {
          kind: 'assistant',
          ts: timestamp(1.2),
          turnId: 'turn-launch-2',
          content: 'I turned those decisions into a concise launch checklist. The only remaining decision is the overnight fallback model.',
        },
        { kind: 'done', ts: timestamp(1.2), turnId: 'turn-launch-2' },
      ],
    },
    {
      summary: {
        id: pixelChatId,
        agentId: 'pixel',
        title: 'Campaign image direction',
        titleSource: 'user',
        pinned: false,
        createdAt: timestamp(19),
        updatedAt: timestamp(3.5),
        messageCount: 4,
        unreadCount: 1,
        lastSeenAt: timestamp(4),
        lastMessageAt: timestamp(3.5),
        lastMessagePreview: 'The tighter crop is ready for review.',
        markerEra: true,
      },
      rows: [
        {
          kind: 'user',
          ts: timestamp(19),
          content: 'Use this direction as the starting point, but make the product read more clearly on mobile.',
          attachments: [
            {
              name: attachmentName,
              mimeType: 'image/jpeg',
              path: pixelAttachmentPath,
            },
          ],
        },
        {
          kind: 'tool',
          ts: timestamp(18.8),
          turnId: 'turn-image-1',
          callId: 'call-image-generate',
          toolName: 'bakin_exec_images_generate',
          status: 'completed',
          summary: 'Generated two mobile-first crop variations',
          inputPreview: '{"aspectRatio":"4:5","emphasis":"product"}',
          outputPreview: '{"assets":["campaign-mobile-a.jpg","campaign-mobile-b.jpg"]}',
          durationMs: 4_280,
        },
        {
          kind: 'assistant',
          ts: timestamp(18.7),
          turnId: 'turn-image-1',
          content: 'I made two mobile-first variants and kept the warmer palette from the reference. Variant B gives the product the clearest silhouette.',
        },
        { kind: 'done', ts: timestamp(18.7), turnId: 'turn-image-1' },
        {
          kind: 'user',
          ts: timestamp(3.8),
          content: 'Go with B and tighten the crop another five percent.',
        },
        {
          kind: 'assistant',
          ts: timestamp(3.5),
          turnId: 'turn-image-2',
          content: 'The tighter crop is ready for review. I preserved enough negative space for the campaign lockup.',
        },
        { kind: 'done', ts: timestamp(3.5), turnId: 'turn-image-2' },
      ],
    },
    {
      summary: {
        id: '00000000-0000-4000-8000-000000000003',
        agentId: 'jessica',
        title: 'Competitor research synthesis',
        titleSource: 'llm',
        pinned: false,
        createdAt: timestamp(54),
        updatedAt: timestamp(8),
        messageCount: 3,
        unreadCount: 1,
        lastSeenAt: timestamp(9),
        lastMessageAt: timestamp(8),
        lastMessagePreview: 'I saved the usable findings and isolated the blocked source.',
        markerEra: true,
      },
      rows: [
        {
          kind: 'user',
          ts: timestamp(54),
          content: 'Compare how the top three competitors explain their entry plan and pricing.',
        },
        {
          kind: 'tool',
          ts: timestamp(53.8),
          turnId: 'turn-research-1',
          callId: 'call-browser-research',
          toolName: 'browser_search',
          status: 'failed',
          summary: 'One source rejected the request',
          outputPreview: '403 Forbidden',
          durationMs: 621,
        },
        {
          kind: 'error',
          ts: timestamp(53.8),
          turnId: 'turn-research-1',
          message: 'One competitor source could not be retrieved. The other two sources were preserved.',
          errorKind: 'source_unavailable',
        },
        {
          kind: 'assistant',
          ts: timestamp(8),
          turnId: 'turn-research-1',
          content: 'I saved the usable findings and isolated the blocked source. The two available competitors both lead with a low-risk entry offer before introducing the full plan.',
        },
        { kind: 'done', ts: timestamp(8), turnId: 'turn-research-1' },
      ],
    },
  ]

  mkdirSync(chatRoot, { recursive: true })
  mkdirSync(pixelAttachmentDir, { recursive: true })
  cpSync(ATTACHMENT_FIXTURE, pixelAttachmentPath)
  writeFileSync(
    join(chatRoot, 'index.json'),
    `${JSON.stringify({ chats: chats.map(({ summary }) => summary) }, null, 2)}\n`,
    'utf-8',
  )
  for (const chat of chats) {
    writeFileSync(
      join(chatRoot, `${chat.summary.id}.jsonl`),
      `${chat.rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf-8',
    )
  }

  console.log(`[seed] Chats seeded (${chats.length} conversations)`)
}
