/**
 * Repair-plan target selection shared by every owner-registered repair
 * action: turns the target the doctor hands a planner into the incident /
 * observation id lists a plan item carries.
 */
import type {
  HealthRepairPlanItem,
  HealthRepairTarget,
} from '@makinbakin/sdk'

export function repairTargetSelection(target: HealthRepairTarget): Pick<
  HealthRepairPlanItem,
  'incidentIds' | 'observationIds' | 'preconditions'
> {
  return {
    incidentIds: target.type === 'incidents' ? [...target.ids] : [],
    observationIds: target.type === 'observations' ? [...target.ids] : [],
    preconditions: [],
  }
}
