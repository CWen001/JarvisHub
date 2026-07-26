export type WebHeroEvidenceDiagnosis = {
  ok: boolean;
  issues: string[];
};

export type WebHeroAssetRequirementsDiagnosis = WebHeroEvidenceDiagnosis & {
  visualSlots: Record<string, unknown>[];
};

export const WEBHERO_ASSET_DECISION_KEYS: readonly [
  "icons",
  "searchAssets",
  "generatedAssets",
  "fontPlan",
  "stylePlan",
];

export function diagnoseWebHeroImplementationBrief(value: unknown): WebHeroEvidenceDiagnosis;
export function diagnoseWebHeroAssetRequirements(
  value: unknown,
  options?: { approvedPreviewNodeIds?: string[] },
): WebHeroAssetRequirementsDiagnosis;
export function diagnoseWebHeroAssetDecisions(value: unknown): WebHeroEvidenceDiagnosis;
export function canonicalWebHeroSectionDraft(value: unknown): unknown;
export function computeWebHeroSectionDraftDigest(value: unknown): string;
export function diagnoseWebHeroSectionDraftContent(value: unknown): WebHeroEvidenceDiagnosis;
export function diagnoseWebHeroSectionDraft(value: unknown): WebHeroEvidenceDiagnosis;
