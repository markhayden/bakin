/**
 * Generate a short random ID. Works in both browser and Node.
 * Returns an 8-character hex string.
 */
export function generateId(): string {
  const bytes = new Uint8Array(4)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
