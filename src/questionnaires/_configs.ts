import type { ProspectConfig } from './_types';
import { herculesConfig } from './hercules';
import { qualifyConfig } from './qualify';

export const questionnaireConfigs = {
  [qualifyConfig.slug]: qualifyConfig,
  [herculesConfig.slug]: herculesConfig,
} satisfies Record<string, ProspectConfig>;

export type QuestionnaireSlug = keyof typeof questionnaireConfigs;

export function getQuestionnaireConfig(slug: string): ProspectConfig | undefined {
  return questionnaireConfigs[slug as QuestionnaireSlug];
}

export function getQuestionnaireSlugs(): QuestionnaireSlug[] {
  return Object.keys(questionnaireConfigs) as QuestionnaireSlug[];
}
