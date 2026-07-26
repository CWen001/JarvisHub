import type { TaskRequestDto } from "./task.schemas";

type SelectedReferenceScope = {
	nodeId?: string | null;
	imageUrl?: string | null;
	sourceUrl?: string | null;
	roleName?: string | null;
	roleCardId?: string | null;
};

export type PublicChatExecutionPlanningDirective = {
	planningRequired: boolean;
	planningMinimumSteps: number;
	checklistFirst: boolean;
	reason: string;
	checklistItems?: string[];
};

export function buildPublicChatExecutionPlanningDirective(input: {
	publicAgentsRequest: boolean;
	requestKind: TaskRequestDto["kind"];
	prompt: string;
	planOnly: boolean;
	canvasProjectId: string;
	canvasNodeId: string;
	selectedNodeKind?: string | null;
	requiredSkills?: string[];
	hasReferenceImages: boolean;
	hasAssetInputs: boolean;
	selectedReference: SelectedReferenceScope | null | undefined;
}): PublicChatExecutionPlanningDirective | null {
	const normalize = (value: unknown): string =>
		typeof value === "string" ? value.trim().toLowerCase() : "";
	const prompt = normalize(input.prompt);
	const selectedNodeKind = normalize(input.selectedNodeKind);
	const requiredSkills = Array.isArray(input.requiredSkills)
		? input.requiredSkills
				.map((item) => normalize(item))
				.filter(Boolean)
		: [];
	const hasCanvasScope =
		Boolean(String(input.canvasProjectId || "").trim()) ||
		Boolean(String(input.canvasNodeId || "").trim());
	const webPageIntent =
		selectedNodeKind === "webhero" ||
		requiredSkills.includes("canvas-brand-web-design") ||
		requiredSkills.includes("canvas-web-design-patterns") ||
		/(^|[\s\u3000])(webhero|web hero|website|landing page|homepage|home page|microsite|官网|网站|网页|落地页|着陆页)([\s\u3000]|$)/i.test(
			input.prompt,
		);
	if (
		!input.publicAgentsRequest ||
		input.requestKind !== "chat" ||
		input.planOnly ||
		!hasCanvasScope ||
		!webPageIntent
	) {
		return null;
	}
	const checklistItems = [
		"style_reference_selection: search real style references, ask the user to choose one, persist selectedStyleReference and sharedStyleBible before anything else.",
		"preview_generation: generate 3-4 approved 16:9 section previews that all follow the sharedStyleBible, then persist approvedPreviewNodes.",
		"asset_inventory: write a non-empty implementation brief, visibleSubjectInventory, complete flat webPageAssetRequirements.visualSlots, and the five-part webPageAssetDecisions object before any codegen.",
		"asset_resolution: resolve every required image_asset slot via search or generation; prefer one webhero_asset_generator subagent per preview/slot so root context stays small, then persist webPageResolvedAssets and ensure the asset board is populated.",
		"final_code: debug/resume first. Call webhero_debug_resume_plan on the current flow and target node, reuse valid existing previews/assets/drafts, have root run one full section_codegen only for each missing, timed-out, blocked, alias-only, or provenance-invalid section when nextAction=dispatch_codegen_only, and persist only the exact successful structured output so runtime provenance can be injected; then have root directly dispatch webhero_merge_codegen only when nextAction=dispatch_merge_only. Never hand-author or normalize a failed section draft, and do not wrap all sections in a coarse codegen agent.",
	];
	return {
		planningRequired: true,
		planningMinimumSteps: 5,
		checklistFirst: true,
		reason:
			selectedNodeKind === "webhero"
				? "webhero_selected_node_preview_first_workflow"
				: "webhero_prompt_preview_first_workflow",
		checklistItems,
	};
}
