/**
 * Media store locations + receipt (#889). Split from the installer so the
 * sharp loader can resolve the store without importing install machinery.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getBakinPaths } from '../content-dir'
import { SHARP_PIN, type MediaPlatformKey } from './pin'

export const MEDIA_RECEIPT_SCHEMA = 1

export interface MediaReceipt {
  schema: number
  sharpVersion: string
  platform: MediaPlatformKey
  /** Store-relative path of the bundled sharp entry. */
  entry: string
  installedAt: string
  tarballs: { name: string; version: string; sha256: string }[]
}

/** `<bakin-home>/media/sharp/<pinned version>/` — the live store dir. */
export function mediaStoreDir(): string {
  return join(getBakinPaths().media, 'sharp', SHARP_PIN.version)
}

export function mediaReceiptPath(): string {
  return join(mediaStoreDir(), 'receipt.json')
}

export function readMediaReceipt(): MediaReceipt | null {
  try {
    const raw = readFileSync(mediaReceiptPath(), 'utf-8')
    const parsed = JSON.parse(raw) as MediaReceipt
    if (parsed.schema !== MEDIA_RECEIPT_SCHEMA || parsed.sharpVersion !== SHARP_PIN.version) return null
    return parsed
  } catch {
    // Missing or unreadable receipt — the store is not installed. (No log:
    // this is the NORMAL state on dev trees and fresh installs.)
    return null
  }
}

/** The bundled sharp entry the loader imports, or null without a valid receipt. */
export function mediaStoreEntry(): string | null {
  const receipt = readMediaReceipt()
  if (!receipt) return null
  const entry = join(mediaStoreDir(), receipt.entry)
  return existsSync(entry) ? entry : null
}
