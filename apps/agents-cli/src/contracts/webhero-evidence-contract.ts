import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type WebHeroEvidenceDiagnosis = {
  ok: boolean;
  issues: string[];
};

export type WebHeroAssetRequirementsDiagnosis = WebHeroEvidenceDiagnosis & {
  visualSlots: Record<string, unknown>[];
};

type WebHeroEvidenceContractModule = {
  WEBHERO_ASSET_DECISION_KEYS: readonly [
    "icons",
    "searchAssets",
    "generatedAssets",
    "fontPlan",
    "stylePlan",
  ];
  diagnoseWebHeroImplementationBrief: (value: unknown) => WebHeroEvidenceDiagnosis;
  diagnoseWebHeroAssetRequirements: (
    value: unknown,
    options?: { approvedPreviewNodeIds?: string[] },
  ) => WebHeroAssetRequirementsDiagnosis;
  diagnoseWebHeroAssetDecisions: (value: unknown) => WebHeroEvidenceDiagnosis;
  canonicalWebHeroSectionDraft: (value: unknown) => unknown;
  computeWebHeroSectionDraftDigest: (value: unknown) => string;
  diagnoseWebHeroSectionDraftContent: (value: unknown) => WebHeroEvidenceDiagnosis;
  diagnoseWebHeroSectionDraft: (value: unknown) => WebHeroEvidenceDiagnosis;
};

const require = createRequire(import.meta.url);
const modulePath = fileURLToPath(new URL(
  "../../../../packages/schemas/webhero-evidence-contract/index.js",
  import.meta.url,
));
const contract = require(modulePath) as WebHeroEvidenceContractModule;

export const WEBHERO_ASSET_DECISION_KEYS = contract.WEBHERO_ASSET_DECISION_KEYS;
export const diagnoseWebHeroImplementationBrief = contract.diagnoseWebHeroImplementationBrief;
export const diagnoseWebHeroAssetRequirements = contract.diagnoseWebHeroAssetRequirements;
export const diagnoseWebHeroAssetDecisions = contract.diagnoseWebHeroAssetDecisions;
export const canonicalWebHeroSectionDraft = contract.canonicalWebHeroSectionDraft;
export const computeWebHeroSectionDraftDigest = contract.computeWebHeroSectionDraftDigest;
export const diagnoseWebHeroSectionDraftContent = contract.diagnoseWebHeroSectionDraftContent;
export const diagnoseWebHeroSectionDraft = contract.diagnoseWebHeroSectionDraft;
