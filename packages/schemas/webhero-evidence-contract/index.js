"use strict";

const { createHash } = require("node:crypto");

const WEBHERO_ASSET_DECISION_KEYS = [
  "icons",
  "searchAssets",
  "generatedAssets",
  "fontPlan",
  "stylePlan",
];

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasMeaningfulValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => key.trim() && hasMeaningfulValue(item));
}

function isNonEmptyDecisionRecordArrayOrEmptyReason(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => isPlainRecord(item) && hasMeaningfulValue(item));
  }
  return isPlainRecord(value) && readString(value.emptyReason).length > 0;
}

function hasPreviewIdentity(record) {
  return Boolean(
    readString(record.previewNodeId) ||
    readString(record.sourcePreviewNodeId) ||
    readString(record.webPreviewNodeId) ||
    readString(record.previewId) ||
    readString(record.approvedPreviewNodeId) ||
    readString(record.sectionId) ||
    readString(record.section) ||
    readString(record.webScreenshotSectionId) ||
    readString(record.targetSectionId) ||
    readString(record.screenshotOrder) ||
    readString(record.webScreenshotOrder) ||
    readString(record.previewOrder) ||
    readString(record.order) ||
    (typeof record.screenshotOrder === "number" && Number.isFinite(record.screenshotOrder)) ||
    (typeof record.order === "number" && Number.isFinite(record.order))
  );
}

function readAssetId(record) {
  return (
    readString(record.assetId) ||
    readString(record.id) ||
    readString(record.requirementId) ||
    readString(record.webPageAssetId)
  );
}

function readRenderMode(record) {
  return readString(record.renderMode) || readString(record.type) || readString(record.category);
}

function readImplementation(record) {
  return readString(record.implementation) || readString(record.decision);
}

function slotRequiresPreviewEvidence(record) {
  const token = `${readRenderMode(record)} ${readImplementation(record)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (/code_procedural|procedural_only|reference_only/.test(token)) return false;
  return /image|photo|media|portrait|product|device|scene|lifestyle|screen|generate|search|reuse/.test(token);
}

function diagnoseWebHeroImplementationBrief(value) {
  const issues = [];
  if (!isPlainRecord(value) || !hasMeaningfulValue(value)) {
    issues.push("webPageImplementationBrief must be a non-empty object");
  }
  return { ok: issues.length === 0, issues };
}

function diagnoseWebHeroAssetRequirements(value, options = {}) {
  const issues = [];
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issues: ["webPageAssetRequirements must be an object"],
      visualSlots: [],
    };
  }
  if (!Array.isArray(value.visualSlots) || value.visualSlots.length === 0) {
    return {
      ok: false,
      issues: ["webPageAssetRequirements.visualSlots must be a non-empty flat array"],
      visualSlots: [],
    };
  }

  const visualSlots = [];
  value.visualSlots.forEach((slot, index) => {
    const path = `webPageAssetRequirements.visualSlots[${index}]`;
    if (!isPlainRecord(slot)) {
      issues.push(`${path} must be an object`);
      return;
    }
    visualSlots.push(slot);
    if (Array.isArray(slot.slots)) issues.push(`${path} must be flat, not grouped`);
    if (!hasPreviewIdentity(slot)) issues.push(`${path}.previewNodeId or screenshotOrder or sectionId`);
    if (!readString(slot.subjectId)) issues.push(`${path}.subjectId`);
    if (!readString(slot.slotId)) issues.push(`${path}.slotId`);
    if (!readString(slot.description)) issues.push(`${path}.description`);
    if (!readAssetId(slot)) issues.push(`${path}.assetId`);
    if (!readImplementation(slot)) issues.push(`${path}.implementation`);
    if (!readRenderMode(slot)) issues.push(`${path}.renderMode`);
    if (!readString(slot.status)) issues.push(`${path}.status`);
    if (!hasMeaningfulValue(slot.intendedWebUsage)) issues.push(`${path}.intendedWebUsage`);
    if (
      slotRequiresPreviewEvidence(slot) &&
      !readString(slot.visualSpecId) &&
      !readString(slot.sourceVisualSpecId) &&
      !readString(slot.previewVisualSpecId) &&
      !hasMeaningfulValue(slot.sourceEvidence)
    ) {
      issues.push(`${path}.visualSpecId or sourceEvidence`);
    }
  });

  const approvedPreviewNodeIds = Array.isArray(options.approvedPreviewNodeIds)
    ? Array.from(new Set(options.approvedPreviewNodeIds.map(readString).filter(Boolean)))
    : [];
  for (const previewNodeId of approvedPreviewNodeIds) {
    const covered = visualSlots.some((slot) => [
      slot.previewNodeId,
      slot.sourcePreviewNodeId,
      slot.webPreviewNodeId,
      slot.previewId,
      slot.approvedPreviewNodeId,
    ].map(readString).includes(previewNodeId));
    if (!covered) {
      issues.push(`webPageAssetRequirements.visualSlots missing approved preview ${previewNodeId}`);
    }
  }

  return { ok: issues.length === 0, issues, visualSlots };
}

function diagnoseWebHeroAssetDecisions(value) {
  const issues = [];
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      issues: ["webPageAssetDecisions must be an object"],
    };
  }
  for (const key of WEBHERO_ASSET_DECISION_KEYS) {
    if (key === "generatedAssets") continue;
    if (!isNonEmptyDecisionRecordArrayOrEmptyReason(value[key])) {
      issues.push(`webPageAssetDecisions.${key} must be a non-empty record array or { emptyReason }`);
    }
  }
  if (Array.isArray(value.generatedAssets)) {
    if (value.generatedAssets.length === 0) {
      issues.push("webPageAssetDecisions.generatedAssets must contain a real generated asset record");
    }
    value.generatedAssets.forEach((item, index) => {
      const path = `webPageAssetDecisions.generatedAssets[${index}]`;
      if (!isPlainRecord(item)) {
        issues.push(`${path} must be an object`);
        return;
      }
      if (!readString(item.slotId)) issues.push(`${path}.slotId`);
      if (!readAssetId(item)) issues.push(`${path}.assetId`);
      if (!readString(item.sourceNodeId) && !readString(item.generatedNodeId)) {
        issues.push(`${path}.sourceNodeId or generatedNodeId`);
      }
    });
  } else {
    issues.push("webPageAssetDecisions.generatedAssets must be a non-empty array");
  }
  return { ok: issues.length === 0, issues };
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isPlainRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      if (typeof value[key] !== "undefined") out[key] = stableJsonValue(value[key]);
      return out;
    }, {});
}

function canonicalWebHeroSectionDraft(draft) {
  if (!isPlainRecord(draft)) return draft;
  const { codegenProvenance: _codegenProvenance, ...content } = draft;
  return stableJsonValue(content);
}

function computeWebHeroSectionDraftDigest(draft) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalWebHeroSectionDraft(draft)))
    .digest("hex")}`;
}

function diagnoseWebHeroSectionDraftContent(value) {
  const issues = [];
  const path = "webPageSectionDrafts[]";
  if (!isPlainRecord(value)) {
    return { ok: false, issues: [`${path} must be an object`] };
  }
  const sectionId = readString(value.sectionId);
  const previewNodeId = readString(value.previewNodeId);
  const order = typeof value.order === "number" ? value.order : Number.parseInt(readString(value.order), 10);
  const html = readString(value.html);
  const css = readString(value.css);
  if (!sectionId) issues.push(`${path}.sectionId`);
  if (!previewNodeId) issues.push(`${path}.previewNodeId`);
  if (!Number.isInteger(order) || order <= 0) issues.push(`${path}.order`);
  if (html.length <= 20) issues.push(`${path}.html`);
  if (css.length <= 20) issues.push(`${path}.css`);
  if (previewNodeId && !html.includes(`data-preview-node-id="${previewNodeId}"`) && !html.includes(`data-preview-node-id='${previewNodeId}'`)) {
    issues.push(`${path}.html data-preview-node-id`);
  }
  for (const key of ["usedAssetIds", "usedAssetUrls", "motionHooks", "consistencyNotes"]) {
    if (!Array.isArray(value[key])) issues.push(`${path}.${key}`);
  }
  if (value.blocked !== false) issues.push(`${path}.blocked must be false`);

  return { ok: issues.length === 0, issues };
}

function diagnoseWebHeroSectionDraft(value) {
  const content = diagnoseWebHeroSectionDraftContent(value);
  const issues = [...content.issues];
  const path = "webPageSectionDrafts[]";
  if (!isPlainRecord(value)) return { ok: false, issues };

  const provenance = value.codegenProvenance;
  if (!isPlainRecord(provenance)) {
    issues.push(`${path}.codegenProvenance`);
  } else {
    if (provenance.version !== "v1") issues.push(`${path}.codegenProvenance.version`);
    if (provenance.source !== "section_codegen") issues.push(`${path}.codegenProvenance.source`);
    if (!readString(provenance.agentToolCallId)) issues.push(`${path}.codegenProvenance.agentToolCallId`);
    if (!readString(provenance.subAgentId)) issues.push(`${path}.codegenProvenance.subAgentId`);
    const expectedDigest = computeWebHeroSectionDraftDigest(value);
    if (readString(provenance.outputDigest) !== expectedDigest) {
      issues.push(`${path}.codegenProvenance.outputDigest mismatch`);
    }
  }

  return { ok: issues.length === 0, issues };
}

module.exports = {
  WEBHERO_ASSET_DECISION_KEYS,
  canonicalWebHeroSectionDraft,
  computeWebHeroSectionDraftDigest,
  diagnoseWebHeroAssetDecisions,
  diagnoseWebHeroAssetRequirements,
  diagnoseWebHeroImplementationBrief,
  diagnoseWebHeroSectionDraftContent,
  diagnoseWebHeroSectionDraft,
};
