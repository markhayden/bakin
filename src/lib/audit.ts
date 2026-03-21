import fs from 'fs'
import path from 'path'
import { getContentDir } from '../core/content-dir'

const AUDIT_FILE = path.join(getContentDir(), 'audit.jsonl')

export function appendAudit(event: string, agent: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, agent, data })
  fs.appendFileSync(AUDIT_FILE, entry + '\n')
}
