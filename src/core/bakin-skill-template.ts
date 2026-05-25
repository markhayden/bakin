import { readFileSync } from 'fs'
import skillTemplatePath from '../../skill/SKILL.md' with { type: 'file' }

export function readEmbeddedBakinSkillTemplate(): string {
  return readFileSync(skillTemplatePath, 'utf-8')
}
