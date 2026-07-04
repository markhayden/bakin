/**
 * `bakin docs` — list registered API routes.
 * Relocated verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet } from '../http'
import { renderInkReport } from '../../core/cli/ui/render-report'

async function printDocsTui(routes: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.DocsReport, { routes })
}

async function cmdDocs(): Promise<void> {
  const docs = await apiGet('/api/docs') as { routes: Array<Record<string, unknown>> }
  if (process.stdout.isTTY) {
    await printDocsTui(docs.routes)
    return
  }
  for (const route of docs.routes) {
    const desc = route.description ? ` — ${route.description}` : ''
    console.log(`${route.method} ${route.fullPath}${desc}`)
  }
}

export async function run(_args: string[]): Promise<void> {
  await cmdDocs()
}
