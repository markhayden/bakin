/**
 * What a person needs to run the `pi` command line tool themselves.
 *
 * The Pi runtime is in-process and needs nothing installed, but logging a
 * provider in is done in pi's own TUI (`/login`), which is a separate
 * install with its own Node floor. These are Pi's facts, so they live here;
 * `tests/architecture/onboarding-runtime-copy.test.ts` checks both against
 * the pinned package's `package.json`.
 */
export const PI_CLI_PACKAGE = '@earendil-works/pi-coding-agent'
/** `engines.node` of the pinned package, as people say it. */
export const PI_CLI_MIN_NODE = '22.19'
/** One sentence for onboarding's first login step. */
export const PI_CLI_INSTALL_HINT = `Not installed yet? \`npm install -g ${PI_CLI_PACKAGE}\` (needs Node ${PI_CLI_MIN_NODE} or newer).`
