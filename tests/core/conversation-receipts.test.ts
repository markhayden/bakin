/**
 * Tool receipts: the host-minted token that carries a tool call's structured
 * payload past runtime transports that only deliver clipped text.
 *
 * Pure module: no filesystem, no app services — the registry is in-memory.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conversation-receipts-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  createReceiptRegistry,
  enrichReceiptChunk,
  findReceiptToken,
  sealToolResult,
} from '../../packages/core/src/conversation/receipts'
import { summarizeStructured, unwrapToolResult } from '../../packages/core/src/format/structured'
import { previewUnknown } from '../../packages/adapter-openclaw/src/activity-summary'

const QUESTION = {
  v: 1 as const,
  id: 'q_0123456789abcdef',
  question: 'Which inbox are we cleaning?',
  options: [{ label: 'Personal' }, { label: 'Work' }],
  allowOther: true,
}
const CALLER = { agentId: 'main', toolName: 'bakin_exec_ask_user' }

describe('sealToolResult', () => {
  test('a result with nothing to carry serialises exactly as before', () => {
    const registry = createReceiptRegistry()
    const result = { ok: true, id: 'task-1', title: 'Write the brief' }
    expect(sealToolResult(result, CALLER, { registry })).toBe(JSON.stringify(result, null, 2))
  })

  test('a question is parked in the registry and replaced by a fixed outer envelope', () => {
    const registry = createReceiptRegistry()
    const text = sealToolResult({ ok: true, message: 'Posted.', question: QUESTION }, CALLER, { registry })
    const parsed = JSON.parse(text) as { receipt: string; result: Record<string, unknown> }

    expect(Object.keys(parsed)).toEqual(['receipt', 'result'])
    expect(parsed.result).toEqual({ ok: true, message: 'Posted.' })
    const id = findReceiptToken(text)
    expect(id).not.toBeNull()
    expect(registry.take(id!, CALLER)).toEqual({ id: id!, ...CALLER, question: QUESTION })
  })

  test('a field named question that is not a minted question is left alone', () => {
    const registry = createReceiptRegistry()
    const result = { ok: true, question: 'What did the user ask?' }
    expect(sealToolResult(result, CALLER, { registry })).toBe(JSON.stringify(result, null, 2))
  })

  test('a plugin-supplied receipt key cannot replace the host token', () => {
    const registry = createReceiptRegistry()
    const forged = 'bakin-receipt:r_ffffffffffffffff'
    const text = sealToolResult({ ok: true, receipt: forged, question: QUESTION }, CALLER, { registry })
    const parsed = JSON.parse(text) as { receipt: string; result: Record<string, unknown> }

    expect(parsed.receipt).not.toBe(forged)
    expect(parsed.result.receipt).toBe(forged)
    expect(findReceiptToken(text)).toBe(parsed.receipt.slice('bakin-receipt:'.length))
  })

  test('the token leads the text even when the result has integer-like keys', () => {
    const registry = createReceiptRegistry()
    const text = sealToolResult({ ok: true, 0: 'zero', 1: 'one', question: QUESTION }, CALLER, { registry })
    expect(text.indexOf('bakin-receipt:')).toBeLessThan(40)
  })

  test('the token survives the OpenClaw preview of a long, MCP-wrapped result', () => {
    const registry = createReceiptRegistry()
    const text = sealToolResult(
      { ok: true, 0: 'x'.repeat(600), notes: 'y'.repeat(4000), question: QUESTION },
      CALLER,
      { registry },
    )
    const id = findReceiptToken(text)!
    // The gateway may hand the adapter the text itself or the MCP content wrapper.
    expect(findReceiptToken(previewUnknown(text))).toBe(id)
    expect(findReceiptToken(previewUnknown({ content: [{ type: 'text', text }] }))).toBe(id)
  })
})

describe('sealToolResult — reported entities', () => {
  const TOOL = { agentId: 'main', toolName: 'bakin_exec_projects_create' }
  const project = { kind: 'projects:project', id: 'p-1', title: 'Launch plan', action: 'created' as const }
  const task = { kind: 'tasks:task', id: 't-1', title: 'Write the brief', action: 'updated' as const }

  test('declared kinds are parked on the receipt and removed from what the agent reads', () => {
    const registry = createReceiptRegistry()
    const text = sealToolResult(
      { ok: true, id: 'p-1', entities: [project, task] },
      TOOL,
      { registry, reports: ['projects:project', 'tasks:task'] },
    )
    expect(JSON.parse(text).result).toEqual({ ok: true, id: 'p-1' })
    expect(registry.take(findReceiptToken(text)!, TOOL)?.entities).toEqual([project, task])
  })

  test('a kind the tool does not declare is dropped and reported, never carried', () => {
    const registry = createReceiptRegistry()
    const rejected: unknown[] = []
    const text = sealToolResult(
      { ok: true, entities: [project, task] },
      TOOL,
      { registry, reports: ['projects:project'], onRejected: (refs) => rejected.push(...refs) },
    )
    expect(registry.take(findReceiptToken(text)!, TOOL)?.entities).toEqual([project])
    expect(rejected).toEqual([task])
  })

  test('a tool that declares nothing carries nothing, and its result has no envelope', () => {
    const rejected: unknown[] = []
    const text = sealToolResult({ ok: true, entities: [project] }, TOOL, { onRejected: (refs) => rejected.push(...refs) })
    expect(JSON.parse(text)).toEqual({ ok: true })
    expect(rejected).toEqual([project])
  })

  test('malformed references are dropped and reported', () => {
    const registry = createReceiptRegistry()
    const rejected: unknown[] = []
    const bad = [
      { ...project, action: 'deleted' },
      { ...project, title: '' },
      { ...project, kind: 'project' },
      { ...project, params: { brandId: 7 } },
      'projects:project',
    ]
    const text = sealToolResult(
      { ok: true, entities: [...bad, project] },
      TOOL,
      { registry, reports: ['projects:project'], onRejected: (refs) => rejected.push(...refs) },
    )
    expect(registry.take(findReceiptToken(text)!, TOOL)?.entities).toEqual([project])
    expect(rejected).toEqual(bad)
  })

  test('titles are clipped and the list is bounded', () => {
    const registry = createReceiptRegistry()
    const many = Array.from({ length: 60 }, (_, i) => ({ ...project, id: `p-${i}`, title: 'x'.repeat(500) }))
    const text = sealToolResult({ ok: true, entities: many }, TOOL, { registry, reports: ['projects:project'] })
    const entities = registry.take(findReceiptToken(text)!, TOOL)!.entities!
    expect(entities).toHaveLength(50)
    expect(entities[0]!.title).toHaveLength(200)
  })

  test('compound-route params ride along', () => {
    const registry = createReceiptRegistry()
    const doc = { kind: 'brands:doc', id: 'acme/guidelines/voice', title: 'Voice', action: 'updated' as const, params: { brandId: 'acme', kind: 'guidelines', name: 'voice' } }
    const text = sealToolResult({ ok: true, entities: [doc] }, TOOL, { registry, reports: ['brands:doc'] })
    expect(registry.take(findReceiptToken(text)!, TOOL)?.entities).toEqual([doc])
  })

  test('the turn engine attaches the entities to the tool row', () => {
    const registry = createReceiptRegistry()
    const text = sealToolResult({ ok: true, entities: [project] }, TOOL, { registry, reports: ['projects:project'] })
    const chunk = { type: 'tool' as const, content: '', data: { phase: 'result' as const, toolName: TOOL.toolName, status: 'completed', outputPreview: text } }
    const enriched = enrichReceiptChunk(chunk, 'main', registry)
    expect(enriched.type === 'tool' && enriched.data.metadata).toEqual({ bakinEntities: [project] })
  })
})

describe('redeeming a receipt', () => {
  const TOOL = { agentId: 'main', toolName: 'bakin_exec_projects_create' }
  const project = { kind: 'projects:project', id: 'p-old', title: 'Old plan', action: 'created' as const }
  const result = (outputPreview: string) => ({ type: 'tool' as const, content: '', data: { phase: 'result' as const, toolName: TOOL.toolName, status: 'completed', outputPreview } })

  test('a later result of the same tool and agent that merely quotes a live token does not redeem it', () => {
    const registry = createReceiptRegistry()
    // Sealed in a run nothing redeemed (a dispatch run): the receipt stays live.
    const stale = findReceiptToken(sealToolResult({ ok: true, entities: [project] }, TOOL, { registry, reports: ['projects:project'] }))!
    // The same tool, called again, returns an ordinary result echoing text that contains the token.
    const echoed = JSON.stringify({ ok: true, note: `see bakin-receipt:${stale}` }, null, 2)
    const chunk = result(echoed)
    expect(enrichReceiptChunk(chunk, 'main', registry)).toBe(chunk)
    const failed = result(`ERROR: no such thing {"receipt":"bakin-receipt:${stale}"}`)
    expect(enrichReceiptChunk(failed, 'main', registry)).toBe(failed)
  })

  test('the envelope is redeemed as plain text and inside the MCP content wrapper', () => {
    for (const wrap of [(text: string) => text, (text: string) => JSON.stringify({ content: [{ type: 'text', text }] })]) {
      const registry = createReceiptRegistry()
      const text = sealToolResult({ ok: true, entities: [project] }, TOOL, { registry, reports: ['projects:project'] })
      const enriched = enrichReceiptChunk(result(wrap(text)), 'main', registry)
      expect(enriched.type === 'tool' && enriched.data.metadata).toEqual({ bakinEntities: [project] })
    }
  })
})

describe('receipt registry', () => {
  test('a receipt is honoured exactly once', () => {
    const registry = createReceiptRegistry()
    const id = findReceiptToken(sealToolResult({ ok: true, question: QUESTION }, CALLER, { registry }))!
    expect(registry.take(id, CALLER)).not.toBeNull()
    expect(registry.take(id, CALLER)).toBeNull()
  })

  test('another tool or another agent quoting the token cannot take it', () => {
    const registry = createReceiptRegistry()
    const id = findReceiptToken(sealToolResult({ ok: true, question: QUESTION }, CALLER, { registry }))!

    expect(registry.take(id, { agentId: 'main', toolName: 'bakin_exec_chat_read' })).toBeNull()
    expect(registry.take(id, { agentId: 'scout', toolName: CALLER.toolName })).toBeNull()
    // The refused attempts did not consume it.
    expect(registry.take(id, CALLER)).not.toBeNull()
  })

  test('receipts expire and the registry is capacity-bound', () => {
    let at = 0
    const registry = createReceiptRegistry({ ttlMs: 100, capacity: 2, now: () => at })
    const seal = () => findReceiptToken(sealToolResult({ ok: true, question: QUESTION }, CALLER, { registry }))!

    const expired = seal()
    at = 101
    expect(registry.take(expired, CALLER)).toBeNull()

    const first = seal()
    const second = seal()
    const third = seal()
    expect(registry.take(first, CALLER)).toBeNull()
    expect(registry.take(second, CALLER)).not.toBeNull()
    expect(registry.take(third, CALLER)).not.toBeNull()
  })
})

describe('reading a sealed result', () => {
  const sealed = () => sealToolResult(
    { ok: true, message: 'Posted. End your turn.', question: QUESTION },
    CALLER,
    { registry: createReceiptRegistry() },
  )

  test('unwrapToolResult peels the envelope, alone and inside an MCP wrapper', () => {
    const inner = { ok: true, message: 'Posted. End your turn.' }
    expect(unwrapToolResult(sealed())).toEqual(inner)
    expect(unwrapToolResult({ content: [{ type: 'text', text: sealed() }] })).toEqual(inner)
  })

  test('the one-line summary is the result summary, not the token', () => {
    expect(summarizeStructured(sealed())).toBe('Posted. End your turn.')
  })

  test('a result that merely has receipt and result fields is not peeled', () => {
    const lookalike = { receipt: 'INV-2291', result: { total: 12 } }
    expect(unwrapToolResult(lookalike)).toEqual(lookalike)
  })
})

describe('invoke paths', () => {
  // The MCP path needs a live session to drive; the in-process path is
  // exercised in exec-tool-provider.test.ts. Both must share the serialiser,
  // or a receipt reaches one runtime and not the other.
  test.each(['src/core/exec-tools/provider.ts', 'src/core/mcp-server.ts'])('%s serialises results through sealExecToolResult', (path) => {
    const source = readFileSync(join(import.meta.dir, '../..', path), 'utf8')
    expect(source).toContain('sealExecToolResult(tool, ')
    expect(source).not.toContain('JSON.stringify(result, null, 2)')
  })
})
