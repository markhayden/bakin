/**
 * Pinned binary requirement — the ONE schema for `requires.bins`.
 *
 * Capability packs (`bakin-package.json`) and plugins (`bakin-plugin.json`)
 * both declare binaries Bakin downloads, sha256-verifies and installs into
 * `~/.bakin/bin`. They share this module so a rule added here applies to
 * both lanes and the installer (`src/core/agent-packages/bin-installer.ts`)
 * has exactly one shape to honour.
 */
import { z } from 'zod'

/** Platform keys follow process.platform-process.arch (antfly pin convention). */
export const BIN_PLATFORM_KEYS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'] as const
export type BinPlatformKey = (typeof BIN_PLATFORM_KEYS)[number]

export const BinDownloadSchema = z.object({
  // https only — except loopback (test fixtures / local dev registries).
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u),
      { message: 'bin download url must be https' },
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, { message: 'sha256 must be 64 hex chars' }),
  /**
   * Set when the download is an archive rather than the raw binary
   * (GitHub releases commonly ship tarballs). The sha256 pins the ARCHIVE;
   * `member` is the file extracted as the binary.
   */
  archive: z
    .object({
      format: z.literal('tar.gz'),
      member: z.string().min(1).refine((m) => !m.startsWith('/') && !m.startsWith('-') && !m.split('/').includes('..'), {
        message: 'archive member must be a relative path inside the archive (no leading - or /)',
      }),
    })
    .optional(),
  /** Download size in bytes — shown in consent/install UIs when present; never trusted for verification. */
  sizeBytes: z.number().int().positive().optional(),
})

export const BinRequirementSchema = z.object({
  /** Binary name as invoked from PATH (installed into the Bakin bin dir). */
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, { message: 'bin name must be a safe slug' }),
  version: z.string().min(1),
  /** Pinned per-platform downloads. Missing key ⇒ unsupported platform (honest readiness failure). */
  install: z
    .partialRecord(z.enum(BIN_PLATFORM_KEYS), BinDownloadSchema)
    .refine((m) => Object.keys(m).length > 0, { message: 'at least one platform download required' }),
  /** Args for the verify-then-commit run (e.g. ["--version"]). Absent → no verify run. */
  verifyArgs: z.array(z.string()).optional(),
})

export const BinRequirementsSchema = z.array(BinRequirementSchema)

export type BinRequirement = z.infer<typeof BinRequirementSchema>
export type BinDownload = z.infer<typeof BinDownloadSchema>
