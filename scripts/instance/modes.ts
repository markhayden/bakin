/**
 * Resolve parsed args + paths into a concrete execution plan.
 *
 * Pure: no I/O. The lifecycle layer consumes the plan to drive docker compose,
 * env export, and Bakin placement. Keeping this separate makes every
 * (mode × runtime × flag) combination trivially testable.
 */
import type { InstanceArgs, Mode, Runtime, Source } from './args'
import type { InstancePaths } from './paths'

const BAKIN_URL = 'http://host.docker.internal:3737'
/** Agent-visible OpenClaw home inside the container (bind mount of dev/openclaw-home). */
const CONTAINER_OPENCLAW_HOME = '/home/node/.openclaw'

/**
 * Rig antfly child port. MUST stay clear of the machine-managed default —
 * 3738 (and its health port 3739): a non-default URL puts the adapter in
 * guest mode (isLocalDefaultUrl), which is the structural guarantee a rig
 * home can never provision/rewrite the real io.bakin.antfly service.
 * Health port is always port+1 by engine convention.
 */
export const RIG_ANTFLY_PORT = 3838

export function rigAntflySearchUrl(port: number = RIG_ANTFLY_PORT): string {
  return `http://127.0.0.1:${port}`
}

export interface BakinPlan {
  /** host = run on this Mac against the instance; container = run inside it. */
  placement: 'host' | 'container'
  source: Source
  /** auto only for sandbox + --preconfigure (openclaw); otherwise manual. */
  onboard: 'manual' | 'auto'
}

export interface DockerPlan {
  /** docker compose profile to activate, or null for the default gateway. */
  composeProfile: string | null
  /** compose services to bring up. */
  services: string[]
}

export interface AntflyChildPlan {
  port: number
  dataDir: string
}

export interface ThrowawaySettingsPatch {
  runtimeAdapter: Runtime
  searchUrl?: string
}

export interface InstancePlan {
  mode: Mode
  runtime: Runtime
  /** null ⇒ no docker at all (pi host modes): no compose, no docker preflight. */
  docker: DockerPlan | null
  /** env exported for a host-run Bakin (native/isolated); empty for sandbox. */
  hostEnv: Record<string, string>
  bakin: BakinPlan
  /** dirs to wipe before `up` when --fresh; empty otherwise. */
  wipeBeforeUp: string[]
  /** Rig-managed antfly child (isolated mode, BOTH runtimes) — spawned by `dev`, never `up`. */
  antflyChild: AntflyChildPlan | null
  /** Merge-patch for the throwaway BAKIN_HOME's settings.json, or null (native/sandbox). */
  settingsPatch: ThrowawaySettingsPatch | null
}

function hostEnvFor(mode: Mode, runtime: Runtime, paths: InstancePaths): Record<string, string> {
  if (mode === 'sandbox') return {} // container env comes from the compose service

  const env: Record<string, string> = {}
  if (runtime === 'openclaw') {
    // BAKIN_MCP_BASE_URL makes the adapter's provisionToolAccess write
    // mcp.servers entries with a container-reachable URL (the openclaw home is
    // bind-mounted, so the entries land where the gateway reads them).
    // BAKIN_AGENT_PATH_MAP is the reverse direction: agent-reported container
    // workspace paths become host-readable for asset saves / image refs.
    env.OPENCLAW_HOME = paths.openclawHome
    env.OPENCLAW_PATH = paths.shim
    env.BAKIN_URL = BAKIN_URL
    env.BAKIN_MCP_BASE_URL = BAKIN_URL
    env.BAKIN_AGENT_PATH_MAP = `${CONTAINER_OPENCLAW_HOME}=${paths.openclawHome}`
    env.BAKIN_RUNTIME_ADAPTER = 'openclaw'
  } else {
    // Pi is in-process on the host: no container, no MCP callback URL, no
    // OpenClaw env. PI_HOME isolates all Pi state under dev/.
    env.BAKIN_RUNTIME_ADAPTER = 'pi'
    env.PI_HOME = paths.piHome
  }
  if (paths.bakinHome) env.BAKIN_HOME = paths.bakinHome
  if (mode === 'isolated') {
    // Belt for the launchd-clobber guard: if the guest-URL settings patch is
    // ever lost, child mode still never writes an OS service unit (the env
    // override accepts launchd|systemd|child only — 'guest' is URL-derived).
    env.BAKIN_SEARCH_SERVICE_MODE = 'child'
  }
  return env
}

function dockerFor(mode: Mode, runtime: Runtime): DockerPlan | null {
  if (mode === 'sandbox') {
    return runtime === 'pi'
      ? { composeProfile: 'sandbox-pi', services: ['sandbox-pi'] }
      : { composeProfile: 'sandbox', services: ['sandbox'] }
  }
  // native + isolated: the gateway container exists only for openclaw.
  return runtime === 'openclaw' ? { composeProfile: null, services: ['openclaw-gateway'] } : null
}

export function resolvePlan(args: InstanceArgs, paths: InstancePaths): InstancePlan {
  const isolated = args.mode === 'isolated'
  return {
    mode: args.mode,
    runtime: args.runtime,
    docker: dockerFor(args.mode, args.runtime),
    hostEnv: hostEnvFor(args.mode, args.runtime, paths),
    bakin: {
      placement: args.mode === 'sandbox' ? 'container' : 'host',
      source: args.source,
      onboard: args.mode === 'sandbox' && args.preconfigure ? 'auto' : 'manual',
    },
    wipeBeforeUp: args.fresh ? paths.resetTargets : [],
    antflyChild: isolated ? { port: RIG_ANTFLY_PORT, dataDir: paths.antflyDataDir } : null,
    settingsPatch: isolated
      ? { runtimeAdapter: args.runtime, searchUrl: rigAntflySearchUrl() }
      : null,
  }
}
