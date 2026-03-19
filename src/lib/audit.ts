import fs from 'fs'
import path from 'path'

const AUDIT_FILE = path.join(process.cwd(), 'content', 'audit.jsonl')

export function appendAudit(event: string, agent: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, agent, data })
  fs.appendFileSync(AUDIT_FILE, entry + '\n')
}
