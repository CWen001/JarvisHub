import { loadWebHeroEvidenceContractModule } from "../../platform/node/shared-schema-loader";

const contract = loadWebHeroEvidenceContractModule();

export const WEBHERO_ASSET_DECISION_KEYS = contract.WEBHERO_ASSET_DECISION_KEYS;
export const diagnoseWebHeroImplementationBrief = contract.diagnoseWebHeroImplementationBrief;
export const diagnoseWebHeroAssetRequirements = contract.diagnoseWebHeroAssetRequirements;
export const diagnoseWebHeroAssetDecisions = contract.diagnoseWebHeroAssetDecisions;
export const canonicalWebHeroSectionDraft = contract.canonicalWebHeroSectionDraft;
export const computeWebHeroSectionDraftDigest = contract.computeWebHeroSectionDraftDigest;
export const diagnoseWebHeroSectionDraftContent = contract.diagnoseWebHeroSectionDraftContent;
export const diagnoseWebHeroSectionDraft = contract.diagnoseWebHeroSectionDraft;
