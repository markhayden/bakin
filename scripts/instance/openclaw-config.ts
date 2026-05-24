/**
 * Build the non-interactive OpenClaw CLI commands that configure a fresh
 * container (per T0 probe findings in tasks/probe-findings.md).
 *
 * Pure: returns ordered argv arrays (the part after `openclaw`). The lifecycle
 * layer prefixes the docker exec + entrypoint and runs them. Codex OAuth is
 * interactive and lives in codex.ts, not here.
 *
 * Boundary: this module is the OpenClaw dev rig (exempt from the provider-
 * boundary rules — see tests/architecture/adapter-boundary.test.ts).
 */

export interface DiscordConfigInput {
  /** Bot token, already resolved from 1Password (inline, like brave). */
  token: string
  guildId?: string
  userId?: string
}

export interface OpenClawConfigInput {
  /** brave-search API key, already resolved from 1Password. */
  braveApiKey: string
  /** Optional Discord channel (D5: kept, off by default). */
  discord?: DiscordConfigInput
}

const BRAVE_MCP_SPEC = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-brave-search'],
}

export function buildConfigCommands(input: OpenClawConfigInput): string[][] {
  const cmds: string[][] = []

  // brave-search first — it's the one default tool and must always register.
  cmds.push([
    'mcp',
    'set',
    'brave-search',
    JSON.stringify({ ...BRAVE_MCP_SPEC, env: { BRAVE_API_KEY: input.braveApiKey } }),
  ])

  // The Discord channel plugin must be installed before the channel works.
  // --force makes it idempotent across re-runs (else "plugin already exists").
  if (input.discord) {
    cmds.push(['plugins', 'install', '@openclaw/discord', '--force'])
  }

  // plugins.allow is a STRICT allowlist — anything not named is blocked, even
  // stock plugins. The Codex provider (the LLM) ships stock-but-disabled, so it
  // must be both allowlisted AND enabled or `models auth login` reports "No
  // provider plugins found". Discord is a non-stock plugin that likewise must be
  // allowlisted (without it, `agents add` sees an empty allowlist, looks failed,
  // and the adapter falls back to a HOST workspace path that breaks dispatch).
  const allow = ['codex', ...(input.discord ? ['discord'] : [])]
  cmds.push(['config', 'set', 'plugins.allow', JSON.stringify(allow), '--strict-json'])
  // enable is idempotent (exit 0 + "Restart to apply" when already enabled).
  cmds.push(['plugins', 'enable', 'codex'])

  if (input.discord) {
    const { token, guildId, userId } = input.discord
    // Resolved token inline (the home is disposable + gitignored, like brave).
    cmds.push(['config', 'set', 'channels.discord.token', token])
    cmds.push(['config', 'set', 'channels.discord.enabled', 'true', '--strict-json'])

    if (userId) {
      // Pre-authorize the owner's DMs. Guild access is the allowlist below, but
      // direct messages are gated by commands.ownerAllowFrom — without this a
      // fresh instance answers the first DM with "access not configured" + a
      // pairing code (the manual `openclaw pairing approve discord <code>` dance).
      // Setting it here means it survives every wipe/restart.
      cmds.push([
        'config', 'set', 'commands.ownerAllowFrom', JSON.stringify([`discord:${userId}`]), '--strict-json',
      ])
    }

    if (guildId) {
      cmds.push(['config', 'set', 'channels.discord.groupPolicy', '"allowlist"', '--strict-json'])
      const guild: { requireMention: boolean; users?: string[] } = { requireMention: false }
      if (userId) guild.users = [userId]
      cmds.push([
        'config', 'set', `channels.discord.guilds.${guildId}`, JSON.stringify(guild), '--strict-json',
      ])
    }
  }

  return cmds
}
