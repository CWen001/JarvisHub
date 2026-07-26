import type { PublicFlowAnchorBinding } from "../flow/flow.anchor-bindings";

export type ChatPromptSkill = {
	key: string | null;
	name: string | null;
	content?: string | null;
};

export type PersonaContextFile = {
	name: "IDENTITY.md" | "SOUL.md";
	path: string;
	content: string;
};

export type PersonaIdentity = {
	name: string | null;
	product: string | null;
	role: string | null;
};

export type PublicChatReferenceImageSlot = {
	slot: string;
	url: string;
	role: string | null;
	label: string | null;
	note: string | null;
};

export type PublicChatSelectedMediaReference = {
	nodeId?: string;
	kind: "image" | "video";
	url: string;
	thumbnailUrl?: string;
	label?: string;
};

export type PublicChatPromptContext = {
	currentProjectName: string | null;
	skill: ChatPromptSkill | null;
	referenceImageCount: number;
	referenceImageSlots: PublicChatReferenceImageSlot[];
	selectedMediaReferences?: PublicChatSelectedMediaReference[];
	assetRoleSummary: string[];
	hasTargetImage: boolean;
	hasSelectedNode: boolean;
	selectedNodeId: string | null;
	selectedNodeLabel: string | null;
	selectedNodeKind: string | null;
	selectedNodeTextPreview: string | null;
	selectedReference: {
		nodeId: string | null;
		label: string | null;
		kind: string | null;
		anchorBindings?: PublicFlowAnchorBinding[];
		roleName?: string | null;
		roleCardId?: string | null;
		imageUrl: string | null;
		sourceUrl: string | null;
			productionLayer: string | null;
			creationStage: string | null;
			approvalStatus: string | null;
			hasUpstreamTextEvidence: boolean;
			hasDownstreamComposeVideo: boolean;
	} | null;
};
