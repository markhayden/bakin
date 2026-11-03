/**
 * The ONE classification of a not-ready capability pack into what fixes it
 * (self-healing spec, re-homing row 6). Pure: the Health check names the
 * repair from it and the `package-sync` / `package-reinstall` actions select
 * their packs with it, so the button a card shows is the button that runs.
 *
 * - `package-reinstall`: a declared binary is missing or its bytes drifted
 *   from the pin, or the installed manifest is no longer valid — the recorded
 *   pack is re-staged from its source and every leg re-installed.
 * - `package-sync`: a projected skill, an npm payload or a model is missing
 *   or unresolved — a sync re-projects and re-installs content.
 * - `human`: a required secret or a required prereq (user-installed tool)
 *   is missing — nothing Bakin can install.
 * - `observation`: only platform gaps or optional prereqs remain.
 * - `null`: the pack is ready.
 *
 * A reinstall need outranks a sync need: it re-does the sync's work too.
 */
import type { CapabilityReadiness } from './capability-readiness'

export type CapabilityRemedy = 'package-reinstall' | 'package-sync' | 'human' | 'observation'

export function capabilityRemedy(cap: CapabilityReadiness): CapabilityRemedy | null {
  if (cap.ready) return null
  if (!cap.manifestValid || cap.bins.some((bin) => bin.status === 'missing' || bin.status === 'drifted')) return 'package-reinstall'
  if (
    cap.skills.some((skill) => skill.status === 'missing')
    || cap.npm.some((payload) => payload.status !== 'ok')
    || cap.models.some((model) => model.status === 'missing')
  ) return 'package-sync'
  if (
    cap.secrets.some((secret) => secret.required && secret.status === 'missing')
    || cap.prereqs.some((prereq) => !prereq.optional && prereq.status === 'missing')
  ) return 'human'
  return 'observation'
}
