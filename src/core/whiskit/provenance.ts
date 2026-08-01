/**
 * Whiskit build provenance — the `.whiskit/build.json` record stamped into a
 * published artifact at build time and used by the consumer install path +
 * startup verifier to decide whether an artifact is valid for this host.
 *
 * Schema is versioned (WHISKIT_PROVENANCE_VERSION); a host that cannot satisfy
 * an artifact's `externalsContract` marks it needs-update rather than rebuilding
 * (consumers never build). Part of the Whiskit artifact format
 * (Phase 3). See `.claude/specs/whiskit-plugin-builder.md` (Build Provenance).
 */
import { readFileSync } from 'fs'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/install-core/atomic-write'
import { supportsExternalsContract } from './externals'

export const WHISKIT_PROVENANCE_VERSION = 2

/** Filename under the artifact's `.whiskit/` directory. */
export const PROVENANCE_FILENAME = 'build.json'

const ApprovedInstallScriptSchema = z.object({
  package: z.string().min(1),
  version: z.string().min(1),
  reason: z.string().min(1),
})

export const WhiskitBuildProvenanceSchema = z.object({
  version: z.literal(WHISKIT_PROVENANCE_VERSION),
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  /** Bakin version the artifact was built against. */
  bakinVersion: z.string().min(1),
  /** Resolved compatibility range (from the manifest `bakin` field or stamped at publish). */
  bakinRange: z.string().min(1),
  whiskitVersion: z.string().min(1),
  buildBackend: z.string().min(1),
  platform: z.string().min(1),
  /** Resolved commit SHA for github sources; '' for local. */
  sourceCommitSha: z.string().default(''),
  sourceTreeSha: z.string().min(1),
  manifestSha: z.string().min(1),
  packageLockSha: z.string().optional(),
  externalsContract: z.string().min(1),
  approvedInstallScripts: z.array(ApprovedInstallScriptSchema).default([]),
  outputs: z.object({
    serverEntry: z.string().min(1),
    clientEntry: z.string().optional(),
    clientCss: z.string().optional(),
    /** node_modules paths kept for native/runtime deps the bundle can't inline. */
    runtimeModules: z.array(z.string()).optional(),
  }),
  builtAt: z.string().min(1),
})

export type WhiskitBuildProvenance = z.infer<typeof WhiskitBuildProvenanceSchema>

/** Validate an untrusted value as provenance; throws a ZodError on mismatch. */
export function parseProvenance(raw: unknown): WhiskitBuildProvenance {
  return WhiskitBuildProvenanceSchema.parse(raw)
}

/** Read + validate provenance from disk. */
export function readProvenance(path: string): WhiskitBuildProvenance {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw new Error(
      `Whiskit provenance at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseProvenance(parsed)
}

/** Validate then atomically write provenance to disk. */
export function writeProvenance(path: string, provenance: WhiskitBuildProvenance): void {
  atomicWriteJson(path, WhiskitBuildProvenanceSchema.parse(provenance))
}

/**
 * True iff this host provides every external expected by the artifact. Contract
 * versions are additive within one family, so a v2 host can load a v1 artifact.
 */
export function isExternalsContractCompatible(provenance: WhiskitBuildProvenance): boolean {
  return supportsExternalsContract(provenance.externalsContract)
}
