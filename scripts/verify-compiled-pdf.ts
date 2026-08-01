/**
 * Compiled-binary PDF smoke check (#746 exit b) — proves the engine's
 * canvas-less text path inside a REAL `bun build --compile` binary:
 *   1. readPdf extracts the text fixture's sentinel (stubs + embedded worker),
 *   2. renderPdfPages throws the typed `pdf_unavailable` (honest degrade).
 *
 * Run manually or from release verification: `bun run verify:compiled-pdf`.
 * Kept OUT of the test suite — it compiles a binary (seconds, disk churn).
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const repoRoot = join(import.meta.dir, '..')
const workDir = mkdtempSync(join(tmpdir(), 'bakin-compiled-pdf-'))
const entry = join(repoRoot, '.compiled-pdf-smoke-entry.ts') // repo root: node_modules must resolve at build time

writeFileSync(entry, `
import { readPdf, renderPdfPages, PdfError } from './src/core/pdf/engine'
const fixture = process.argv[2]!
const text = await readPdf(fixture)
if (!text.pages[0]!.text.includes('alpha-7291')) throw new Error('sentinel missing — text path broken')
try {
  await renderPdfPages(fixture)
  throw new Error('render unexpectedly succeeded in a compiled binary')
} catch (err) {
  if (!(err instanceof PdfError) || err.kind !== 'pdf_unavailable') throw err
}
console.log('COMPILED-PDF-SMOKE PASS')
`)

try {
  const binary = join(workDir, 'smoke')
  execFileSync('bun', ['build', '--compile', entry, '--outfile', binary], { cwd: repoRoot, stdio: 'pipe' })
  const out = execFileSync(binary, [join(repoRoot, 'tests/fixtures/pdf/text.pdf')], { stdio: 'pipe' }).toString()
  if (!out.includes('COMPILED-PDF-SMOKE PASS')) throw new Error(`unexpected output: ${out}`)
  console.log('verify-compiled-pdf: PASS (text extraction works, render degrades honestly)')
} finally {
  rmSync(entry, { force: true })
  rmSync(workDir, { recursive: true, force: true })
}
