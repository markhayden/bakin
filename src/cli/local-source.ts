import { homedir } from 'os'
import { join, resolve } from 'path'

/**
 * A local install source as the absolute path the server must read. The
 * server resolves a relative path against ITS working directory, which is
 * not the operator's: `bakin packages install ../pack` from another folder
 * would read a different directory (or none) than the one the operator
 * meant. Every other source (catalog name, `github:`, URL, absolute path)
 * passes through unchanged.
 */
export function resolveLocalSource(source: string): string {
  if (source.startsWith('~/')) return join(process.env.HOME || homedir(), source.slice(2))
  if (source === '.' || source === '..' || source.startsWith('./') || source.startsWith('../')) return resolve(process.cwd(), source)
  return source
}
