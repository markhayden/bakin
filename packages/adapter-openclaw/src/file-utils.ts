/**
 * Shared low-level file reads for the OpenClaw adapter.
 *
 * One implementation behind trajectory-forensics (incremental death-watch
 * scans) and runtime.ts (session-file activity tail) — these previously kept
 * near-identical local copies with subtly different edge semantics.
 *
 * Contract:
 *   error            → null
 *   size <  offset   → null, or rewind-to-0 read when opts.rewindOnTruncate
 *                      (log rotation/truncation recovery)
 *   size === offset  → { text: '', nextOffset: offset } (no new bytes —
 *                      distinguishable from an error)
 *   size >  offset   → { text, nextOffset: offset + bytesRead }
 */
import { closeSync, openSync, readSync, statSync } from 'fs'

/** Byte size of a file, 0 when missing/unreadable. */
export function safeFileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export interface FileReadFrom {
  text: string
  nextOffset: number
  /** True when the file shrank below the offset and the read restarted at 0. */
  rewound: boolean
}

export function readFileFrom(
  path: string,
  offset: number,
  opts?: { rewindOnTruncate?: boolean },
): FileReadFrom | null {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    return null
  }

  let rewound = false
  if (size < offset) {
    if (!opts?.rewindOnTruncate) return null
    offset = 0
    rewound = true
  }
  if (size === offset) return { text: '', nextOffset: offset, rewound }

  const length = size - offset
  const buffer = Buffer.alloc(length)
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const bytesRead = readSync(fd, buffer, 0, length, offset)
    return {
      text: buffer.subarray(0, bytesRead).toString('utf-8'),
      nextOffset: offset + bytesRead,
      rewound,
    }
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
