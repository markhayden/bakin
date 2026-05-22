/**
 * Resolve parsed args + paths into a concrete execution plan.
 *
 * Pure: no I/O. The lifecycle layer consumes the plan to drive docker compose,
 * env export, and Bakin placement. Keeping this separate makes every
 * mode/flag combination trivially testable.
 */
import type { InstanceArgs, Mode, Source } from './args'
import type { InstancePaths } from './paths'

const BAKIN_URL = 'http://host.docker.internal:3737'

export interface BakinPlan {
  /** host = run on this Mac against the container; container = run inside it. */
  placement: 'host' | 'container'
  source: Source
  /** auto only for sandbox + --preconfigure; otherwise manual. */
  onboard: 'manual' | 'auto'
}

export interface InstancePlan {
  mode: Mode
  /** docker compose profile to activate, or null for the default gateway. */
  composeProfile: string | null
  /** compose services to bring up. */
  services: string[]
  /** env exported for a host-run Bakin (native/isolated); empty for sandbox. */
  hostEnv: Record<string, string>
  bakin: BakinPlan
  /** dirs to wipe before `up` when --fresh; empty otherwise. */
  wipeBeforeUp: string[]
}

export function resolvePlan(args: InstanceArgs, paths: InstancePaths): InstancePlan {
  const wipeBeforeUp = args.fresh ? paths.resetTargets : []

  if (args.mode === 'sandbox') {
    return {
      mode: 'sandbox',
      composeProfile: 'sandbox',
      services: ['sandbox'],
      hostEnv: {},
      bakin: {
        placement: 'container',
        source: args.source,
        onboard: args.preconfigure ? 'auto' : 'manual',
      },
      wipeBeforeUp,
    }
  }

  // native + isolated: OpenClaw in the gateway container; Bakin runs on the host.
  const hostEnv: Record<string, string> = {
    OPENCLAW_HOME: paths.openclawHome,
    OPENCLAW_PATH: paths.shim,
    BAKIN_URL,
  }
  if (paths.bakinHome) hostEnv.BAKIN_HOME = paths.bakinHome

  return {
    mode: args.mode,
    composeProfile: null,
    services: ['openclaw-gateway'],
    hostEnv,
    bakin: { placement: 'host', source: args.source, onboard: 'manual' },
    wipeBeforeUp,
  }
}
