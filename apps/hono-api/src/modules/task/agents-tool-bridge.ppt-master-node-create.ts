import { randomUUID } from "node:crypto";

import { AppError } from "../../middleware/error";

const PPT_CREATION_FIELDS = [
	"label",
	"content",
	"prompt",
	"systemPrompt",
	"nodeWidth",
	"nodeHeight",
	"outline",
	"audience",
	"tone",
	"format",
	"slideCount",
	"sourceNodeIds",
	"sourceFiles",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readNodeData(value: unknown): Record<string, unknown> {
	return asRecord(asRecord(value)?.data) || {};
}

function readNodeId(value: unknown): string {
	return readString(asRecord(value)?.id);
}

function isPptDeckNode(value: unknown): boolean {
	return readNodeData(value).kind === "pptDeck";
}

function pickPptCreationData(data: Record<string, unknown>): Record<string, unknown> {
	const picked: Record<string, unknown> = {};
	for (const field of PPT_CREATION_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(data, field)) picked[field] = data[field];
	}
	return picked;
}

export type PptMasterWriteAuthority = "project_init" | "svg_write" | "export";

const PPT_WORKSPACE_EVIDENCE_FIELDS = [
	"pptMasterProjectPath",
	"pptMasterRuntime",
	"pptxPath",
	"pptxUrl",
	"lastPptMasterStdout",
	"lastPptMasterStderr",
	"lastPptMasterSvgWrite",
] as const;

const PPT_SLIDE_EVIDENCE_FIELDS = ["svgUrl", "svgPath", "svgMarkup"] as const;

// slides[i].imageUrl is a backend-derived, backend-owned field. Its single
// source of truth is the generated child image node (kind:"image") that carries
// pptDeckImageForNodeId + pptDeckSlideIndex. Agents (and the frontend) must
// never author it: whatever they send is discarded here and the authoritative
// value is recomputed by deriveSlideImageUrls on every reconcile.
const PPT_SLIDE_DERIVED_IMAGE_FIELD = "imageUrl" as const;

function copyOwnProperty(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
	field: string,
): void {
	if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field];
	else delete target[field];
}

function readSlideIndex(value: unknown): number | null {
	const index = Number(asRecord(value)?.index);
	return Number.isInteger(index) && index > 0 ? index : null;
}

function reconcileSlideEvidence(input: {
	existingSlides: unknown;
	nextSlides: unknown;
	allowSvgWrite: boolean;
	clearSvgEvidence: boolean;
}): unknown {
	if (!Array.isArray(input.nextSlides)) return input.nextSlides;
	const existingByIndex = new Map<number, Record<string, unknown>>();
	if (Array.isArray(input.existingSlides)) {
		for (const value of input.existingSlides) {
			const slide = asRecord(value);
			const index = readSlideIndex(slide);
			if (slide && index !== null && !existingByIndex.has(index)) existingByIndex.set(index, slide);
		}
	}
	return input.nextSlides.map((value) => {
		const slide = asRecord(value);
		if (!slide) return value;
		const nextSlide = { ...slide };
		const existingSlide = existingByIndex.get(readSlideIndex(slide) ?? -1) || {};
		// imageUrl is backend-owned: always discard the incoming value and inherit
		// the existing one. deriveSlideImageUrls overwrites it with the authoritative
		// value (or clears it) after reconciliation completes.
		copyOwnProperty(nextSlide, existingSlide, PPT_SLIDE_DERIVED_IMAGE_FIELD);
		if (input.clearSvgEvidence) {
			for (const field of PPT_SLIDE_EVIDENCE_FIELDS) delete nextSlide[field];
			return nextSlide;
		}
		if (input.allowSvgWrite) {
			// The canonical writer publishes svgUrl + immutable svgPath. Inline SVG is never runtime evidence.
			delete nextSlide.svgMarkup;
			return nextSlide;
		}
		for (const field of PPT_SLIDE_EVIDENCE_FIELDS) {
			copyOwnProperty(nextSlide, existingSlide, field);
		}
		return nextSlide;
	});
}

export function buildDefaultPptDeckWorkflowContract(input: {
	nodeId: string;
	data: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		version: 1,
		goal:
			readString(input.data.prompt) ||
			readString(input.data.label) ||
			"PPT Master serial pipeline: research → project → strategy → images → SVG → export",
		targetPptNodeId: input.nodeId,
		currentStep: "topic_research",
		stepStatus: {
			topic_research: "pending",
			project_init: "pending",
			strategist_outline: "pending",
			image_generation: "pending",
			svg_authoring: "pending",
			export_pptx: "pending",
		},
		serialPipeline: [
			"topic_research",
			"project_init",
			"strategist_outline",
			"image_generation",
			"svg_authoring",
			"export_pptx",
		],
		blockingRules: [
			"SERIAL EXECUTION: each step must finish before the next begins.",
			"GATE BEFORE ENTRY: verify prerequisite stepStatus before starting a step.",
			"NO SKIPPING: do not skip topic_research / image_generation / svg_authoring just because you have an outline.",
			"SVG hand-written per page: never batch-generate SVGs via a script loop.",
		],
		acceptanceCriteria: {
			topic_research: [
				"[REQUIRED Step 1/6] When the user only provides a topic with no source file or rich description, gather real source material first. Use available web search / web fetch tools to assemble a research markdown plus reference images. DO NOT skip this step for celebrity / product / company topics.",
				"[REQUIRED] Persist the gathered research summary into pptResearch (Markdown) and pptResearchImages (array of {url, caption}). Set stepStatus.topic_research=completed only after a real research artifact is written.",
				"[REQUIRED] If the user already provided substantive source content in chat or a file, you may compress topic_research to a single canvas_update_node_data write with pptResearch set to the user content and stepStatus.topic_research=completed.",
			],
			project_init: [
				"[REQUIRED Step 2/6] ONLY run after stepStatus.topic_research=completed.",
				"[REQUIRED] Call canvas_ppt_master_project_init with projectName derived from the deck label. The tool runs scripts/project_manager.py init and writes pptMasterProjectPath back to the node.",
				"[REQUIRED] Confirm pptMasterProjectPath is non-empty and stepStatus.project_init=completed before moving on.",
			],
			strategist_outline: [
				"[REQUIRED Step 3/6] ONLY run after stepStatus.project_init=completed.",
				"[REQUIRED] Produce a strategist-style outline: for every slide, persist {index, title, subtitle, section, bullets[3-5], speakerNotes, visualBrief}. Write into slides[] via canvas_update_node_data.",
				"[REQUIRED] visualBrief MUST describe a concrete image / chart / diagram intent per slide (e.g. ‘hero portrait’, ‘timeline 4 milestones’, ‘market-share bar chart’). Empty visualBrief is allowed only for pure-text slides.",
				"[REQUIRED] visualBrief and later image prompts must describe only the in-slide illustration/photo/diagram asset needed by the PPT, not a full PPT slide screenshot, slide layout, title, bullets, footer, or UI chrome. Avoid blue-purple gradients and purple/indigo neon gradient palettes.",
				"[REQUIRED] Set stepStatus.strategist_outline=completed only after slides[] is non-empty.",
			],
			image_generation: [
				"[REQUIRED Step 4/6] ONLY run after stepStatus.strategist_outline=completed. DO NOT SKIP — a PPT without imagery is unacceptable.",
				"[REQUIRED] For every slide whose visualBrief calls for an image / portrait / diagram render, call canvas_image_generate_to_canvas. Generate at most 2 in parallel; wait via canvas_image_wait_for_result. Always pass data.pptDeckImageForNodeId=<this pptDeck nodeId> and data.pptDeckSlideIndex=<slide.index> so the canvas wraps these images in the pptDeck image group instead of letting them overlap with the deck.",
				"[REQUIRED] Every PPT image-generation prompt must explicitly request only the in-slide illustration/photo/chart/diagram asset. Do NOT generate a complete PPT slide screenshot, slide mockup, title block, bullet list, footer, or presentation frame. Do NOT use blue-purple gradients or purple/indigo neon gradient palettes.",
				"[REQUIRED] When calling canvas_image_generate_to_canvas for PPT imagery, pass purpose.kind=\"pptDeckImage\", purpose.forNodeId=<this pptDeck nodeId>, and purpose.slideIndex=<slide.index>. These fields are mandatory: the backend uses them to group the PPT image nodes AND to link each slide to its image.",
				"[REQUIRED] DO NOT set slides[i].imageUrl yourself — it is backend-owned and derived from the generated image node automatically; any value you write is ignored. You only need to append the generated node IDs to pptGeneratedAssetNodes.",
				"[REQUIRED] When the visualBrief is a chart / diagram intended as SVG, mark slides[i].svgIntent=true and skip image generation for that slide.",
				"[REQUIRED] Set stepStatus.image_generation=completed only when every non-text slide has either a generated pptDeckImage OR svgIntent=true.",
			],
			svg_authoring: [
				"[REQUIRED Step 5/6] ONLY run after stepStatus.image_generation=completed. The canvas runtime provides FULL SVG write capability through canvas_ppt_master_write_slide_svg — you DO have local fs access via this tool, do NOT claim the environment cannot write SVG files.",
				"[REQUIRED] For each slide i, build the full <svg viewBox=\"0 0 1280 720\" ...>...</svg> markup by hand (respect canvas size from pptMasterFormat) and call canvas_ppt_master_write_slide_svg with {nodeId, slideIndex: slide.index, svgMarkup}. The server writes an immutable content-addressed SVG artifact and atomically patches slides[i].svgUrl back onto the node.",
				"[REQUIRED] If the slide has a generated image, place it inside the SVG via <image href=\"{{PPT_SLIDE_IMAGE}}\" .../>. The server resolves that exact placeholder from the backend-derived slide imageUrl; do not pass a URL, sourceNodeId, or guessed filename. NEVER replace the generated image with hand-drawn shapes.",
				"[REQUIRED] Author pages SEQUENTIALLY (1 → 2 → ... → N) in one continuous pass. Each call is one page; do NOT batch via scripts.",
				"[REQUIRED] After every slide has been written, run canvas_ppt_master_check_readiness; only set stepStatus.svg_authoring=completed when missing[] is empty for svg_authoring.",
			],
			export_pptx: [
				"[REQUIRED Step 6/6] ONLY run after stepStatus.svg_authoring=completed.",
				"[REQUIRED] Call canvas_ppt_master_export_to_pptx with projectPath=pptMasterProjectPath. The server exports only the immutable SVG artifacts persisted on this deck; no alternate source may be selected.",
				"[REQUIRED] After it returns, the node will carry pptxUrl and pptxPath. Set stepStatus.export_pptx=completed.",
			],
		},
	};
}

export function buildPptMasterNodeCreateData(input: {
	data: Record<string, unknown>;
	nodeId?: string;
}): Record<string, unknown> {
	const nodeId = readString(input.nodeId);
	return {
		...pickPptCreationData(input.data),
		kind: "pptDeck",
		pptMasterWorkspaceId: randomUUID(),
		pptMasterStatus: "draft",
		pptMasterWorkflowContract: buildDefaultPptDeckWorkflowContract({
			nodeId,
			data: input.data,
		}),
	};
}

function isSuccessImageStatus(value: unknown): boolean {
	const status = readString(value).toLowerCase();
	return status === "" || status === "success" || status === "succeeded" ||
		status === "completed" || status === "done";
}

/**
 * slides[i].imageUrl is a derived field. Its single source of truth is the
 * generated child image node (kind:"image") that carries
 * pptDeckImageForNodeId + pptDeckSlideIndex + a real hosted imageUrl.
 *
 * Recomputing it on every reconcile guarantees slides[i].imageUrl is always a
 * real hosted URL (or absent) regardless of what an agent or the frontend
 * wrote. This is the invariant that replaces the former mirror-on-write path,
 * and it is order-independent and self-healing.
 */
function deriveSlideImageUrls(reconciledNodes: ReadonlyArray<unknown>): void {
	// 1) deckId -> (slideIndex -> hosted url), first successful child wins.
	const urlsByDeck = new Map<string, Map<number, string>>();
	for (const raw of reconciledNodes) {
		const data = readNodeData(raw);
		const deckId = readString(data.pptDeckImageForNodeId);
		if (!deckId) continue;
		if (!isSuccessImageStatus(data.status)) continue;
		const url = readString(data.imageUrl);
		if (!/^https?:\/\//i.test(url)) continue;
		const slideIndex = Number(data.pptDeckSlideIndex);
		if (!Number.isInteger(slideIndex) || slideIndex < 1) continue;
		let byIndex = urlsByDeck.get(deckId);
		if (!byIndex) {
			byIndex = new Map<number, string>();
			urlsByDeck.set(deckId, byIndex);
		}
		if (!byIndex.has(slideIndex)) byIndex.set(slideIndex, url);
	}

	// 2) Write the derived url back onto each deck's slides[] (or clear stale values).
	for (const raw of reconciledNodes) {
		if (!isPptDeckNode(raw)) continue;
		const node = asRecord(raw);
		if (!node) continue;
		const data = readNodeData(node);
		if (!Array.isArray(data.slides)) continue;
		const byIndex = urlsByDeck.get(readNodeId(node)) || new Map<number, string>();
		node.data = {
			...data,
			slides: data.slides.map((rawSlide) => {
				const slide = asRecord(rawSlide);
				if (!slide) return rawSlide;
				const url = byIndex.get(readSlideIndex(slide) ?? -1);
				if (url) return { ...slide, imageUrl: url };
				if (Object.prototype.hasOwnProperty.call(slide, "imageUrl")) {
					const { imageUrl: _dropped, ...rest } = slide;
					return rest;
				}
				return slide;
			}),
		};
	}
}

export function reconcilePptMasterNodeIdentities(input: {
	existingNodes: ReadonlyArray<unknown>;
	nextNodes: ReadonlyArray<unknown>;
	writeAuthority?: PptMasterWriteAuthority;
}): unknown[] {
	const existingById = new Map(
		input.existingNodes
			.filter(isPptDeckNode)
			.map((node) => [readNodeId(node), node] as const)
			.filter(([id]) => Boolean(id)),
	);
	const reconciled = input.nextNodes.map((rawNode) => {
		const node = asRecord(rawNode);
		if (!node || !isPptDeckNode(node)) return rawNode;
		const nodeId = readNodeId(node);
		const existing = existingById.get(nodeId);
		if (!existing) {
			return {
				...node,
				data: buildPptMasterNodeCreateData({ data: readNodeData(node), nodeId }),
			};
		}
		const existingData = readNodeData(existing);
		const nextData = { ...readNodeData(node) };
		copyOwnProperty(nextData, existingData, "pptMasterWorkspaceId");
		delete nextData.pptMasterPreviewBaseUrl;

		const authority = input.writeAuthority;
		const projectChanged = authority === "project_init"
			&& readString(existingData.pptMasterProjectPath) !== readString(nextData.pptMasterProjectPath);
		if (authority === "project_init") {
			for (const field of [
				"pptxPath",
				"pptxUrl",
				"lastPptMasterSvgWrite",
			] as const) {
				if (projectChanged) delete nextData[field];
				else copyOwnProperty(nextData, existingData, field);
			}
		} else if (authority === "svg_write") {
			for (const field of [
				"pptMasterProjectPath",
				"pptMasterRuntime",
				"lastPptMasterStdout",
				"lastPptMasterStderr",
			] as const) copyOwnProperty(nextData, existingData, field);
			delete nextData.pptxPath;
			delete nextData.pptxUrl;
		} else if (authority === "export") {
			for (const field of ["pptMasterProjectPath", "lastPptMasterSvgWrite"] as const) {
				copyOwnProperty(nextData, existingData, field);
			}
		} else {
			for (const field of PPT_WORKSPACE_EVIDENCE_FIELDS) copyOwnProperty(nextData, existingData, field);
		}

		if (Object.prototype.hasOwnProperty.call(nextData, "slides")) {
			nextData.slides = reconcileSlideEvidence({
				existingSlides: existingData.slides,
				nextSlides: nextData.slides,
				allowSvgWrite: authority === "svg_write",
				clearSvgEvidence: projectChanged,
			});
		}
		return { ...node, data: nextData };
	});

	const workspaceOwners = new Map<string, string>();
	for (const node of reconciled) {
		if (!isPptDeckNode(node)) continue;
		const workspaceId = readString(readNodeData(node).pptMasterWorkspaceId);
		if (!workspaceId) continue;
		const nodeId = readNodeId(node);
		const owner = workspaceOwners.get(workspaceId);
		if (owner && owner !== nodeId) {
			throw new AppError("PPT Master workspace identity is already owned by another node", {
				status: 409,
				code: "ppt_master_workspace_identity_collision",
				details: { workspaceId, nodeIds: [owner, nodeId] },
			});
		}
		workspaceOwners.set(workspaceId, nodeId);
	}

	// slides[i].imageUrl is backend-owned and derived from generated child image
	// nodes. Recompute it here — the single choke point every flow write passes
	// through — so agent/frontend writes can never leave it stale or invalid.
	deriveSlideImageUrls(reconciled);
	return reconciled;
}

export function reconcilePptMasterGraphIdentities(
	existingGraph: unknown,
	nextGraph: unknown,
	writeAuthority?: PptMasterWriteAuthority,
): unknown {
	const next = asRecord(nextGraph);
	if (!next || !Array.isArray(next.nodes)) return nextGraph;
	const existing = asRecord(existingGraph);
	return {
		...next,
		nodes: reconcilePptMasterNodeIdentities({
			existingNodes: Array.isArray(existing?.nodes) ? existing.nodes : [],
			nextNodes: next.nodes,
			writeAuthority,
		}),
	};
}
