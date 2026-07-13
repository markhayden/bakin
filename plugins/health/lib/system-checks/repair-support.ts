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
