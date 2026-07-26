export const WEBHERO_CODE_INPUT_PHASES = [
	{
		phase: "preview_visual_spec",
		fields: [
			"webPagePreviewVisualSpecs",
			"webPageReferencePrompt",
			"webPageImplementationBrief",
			"fontPlan",
			"previewDetailChecklist",
			"componentReferencePlan",
		],
	},
	{
		phase: "asset_inventory",
		fields: [
			"visibleSubjectInventory",
			"webPageVisibleSubjectInventory",
			"webPageAssetRequirements",
			"webPageAssetDecisions",
		],
	},
	{ phase: "asset_resolution", fields: ["webPageResolvedAssets"] },
	{ phase: "section_codegen", fields: ["webPageSectionDrafts"] },
] as const;

export const WEBHERO_EVIDENCE_PHASE_DESCRIPTION =
	`For WebHero nodes, each patchNodeData[].data must contain exactly one WebHero evidence phase. ${WEBHERO_CODE_INPUT_PHASES
		.map(({ phase, fields }) => `${phase}: ${fields.join(", ")}`)
		.join("; ")}. Persist different phases in separate calls and in this order.`;

// Canonical "is this WebHero value actually present" predicate. Empty strings,
// empty arrays, and objects whose leaves are all empty count as absent. Shared
// so every layer (patch validation, transition coupling, phase detection) agrees
// on what "a value is set" means — divergent copies previously let an empty
// sharedStyleBible pass one check while reading as absent in the next.
export function hasMeaningfulWebHeroEvidence(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (typeof value === "number" || typeof value === "boolean") return true;
	if (Array.isArray(value)) return value.some(hasMeaningfulWebHeroEvidence);
	return Boolean(value) && typeof value === "object"
		&& Object.values(value as Record<string, unknown>).some(hasMeaningfulWebHeroEvidence);
}
