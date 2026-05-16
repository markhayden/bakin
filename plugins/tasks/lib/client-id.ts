export function createShortClientId(length = 8): string {
  const cryptoLike = globalThis.crypto

  if (typeof cryptoLike?.randomUUID === 'function') {
    return cryptoLike.randomUUID().replace(/-/g, '').slice(0, length)
  }

  if (typeof cryptoLike?.getRandomValues === 'function') {
    const bytes = new Uint8Array(Math.ceil(length / 2))
    cryptoLike.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length)
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, length)
}
