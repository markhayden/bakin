/**
 * The setup rewrite: a command word naming one of the pack's bins becomes
 * the path Bakin installed it to (`~/…` under HOME, quoted with a space);
 * arguments that merely contain the name, and other commands, stay.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { rewriteSetupCommand } from '../../src/core/agent-packages/login-setup'

const originalHome = process.env.HOME
afterEach(() => { process.env.HOME = originalHome })

describe('rewriteSetupCommand', () => {
  it('rewrites the leading command word to ~/… under HOME', () => {
    process.env.HOME = '/Users/me'
    expect(rewriteSetupCommand('gog auth setup you@example.com --login', ['gog'], '/Users/me/.bakin/bin'))
      .toBe('~/.bakin/bin/gog auth setup you@example.com --login')
  })

  it('rewrites every command word after a separator, never an argument', () => {
    process.env.HOME = '/Users/me'
    expect(rewriteSetupCommand('gog auth add gog@x.com && export GOG_ACCOUNT=me; gog auth list', ['gog'], '/Users/me/.bakin/bin'))
      .toBe('~/.bakin/bin/gog auth add gog@x.com && export GOG_ACCOUNT=me; ~/.bakin/bin/gog auth list')
  })

  it('leaves a command that does not run the binary, and a longer name, alone', () => {
    process.env.HOME = '/Users/me'
    expect(rewriteSetupCommand('gh auth login', ['gog'], '/Users/me/.bakin/bin')).toBe('gh auth login')
    expect(rewriteSetupCommand('gogcli auth', ['gog'], '/Users/me/.bakin/bin')).toBe('gogcli auth')
  })

  it('keeps an absolute path outside HOME and quotes a path with a space', () => {
    process.env.HOME = '/Users/me'
    expect(rewriteSetupCommand('gog auth', ['gog'], '/opt/bakin/bin')).toBe('/opt/bakin/bin/gog auth')
    expect(rewriteSetupCommand('gog auth', ['gog'], '/Users/me/My Bakin/bin')).toBe('~/"My Bakin/bin/gog" auth')
  })
})
