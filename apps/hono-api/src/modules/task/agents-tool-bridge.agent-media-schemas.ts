import { z } from "zod";

import {
  PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
  PUBLIC_FLOW_REFERENCE_RELATIONSHIP_KINDS,
  type PublicFlowAnchorBindingKind,
} from "../flow/flow.anchor-bindings";
import { optionalNonEmptyString } from "../flow/flow.public.schemas";
import {
  DirectImageGenerateToCanvasArgsInputSchema,
  DirectVideoGenerateToCanvasArgsInputSchema,
} from "./agents-tool-bridge.direct-media-schemas";

const ImageResolutionSchema = z.enum(["1K", "2K", "4K"]);
const VideoResolutionSchema = z.enum(["720p", "1080p"]);
const AudioModeSchema = z.enum(["auto", "silent", "withAudio"]);

const JsonObjectSchema = z.record(z.unknown());

export const AgentMediaReferenceSchema = z
  .object({
    url: optionalNonEmptyString,
    role: z.string().optional(),
    sourceNodeId: z.string().optional(),
    assetId: z.string().optional(),
    assetRefId: z.string().optional(),
    weight: z.number().finite().optional(),
    relationshipKind: z.enum(PUBLIC_FLOW_REFERENCE_RELATIONSHIP_KINDS).optional(),
    note: z.string().optional(),
    name: z.string().optional(),
  })
  .strict()
  .superRefine((reference, ctx) => {
    if (reference.sourceNodeId || reference.assetId || reference.url) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "reference requires sourceNodeId, assetId, or an external url; assetRefId is metadata only",
    });
  });

export const AgentImagePurposeSchema = z
  .object({
    kind: z.enum(["storyboard", "visualAsset", "webPreview", "webPageAsset", "pptDeckImage"]).optional(),
    forNodeId: z.string().optional(),
	flowUpdatedAt: z.string().min(1).max(80).optional(),
    assetId: z.string().optional(),
    slotId: z.string().optional(),
	sectionId: optionalNonEmptyString,
	order: z.number().int().positive().optional(),
    slideIndex: z.number().int().positive().optional(),
    slideId: z.string().optional(),
    source: z.string().optional(),
    role: z.string().optional(),
    category: z.string().optional(),
    placement: z.string().optional(),
    requirement: JsonObjectSchema.optional(),
    transparentPng: z.boolean().optional(),
  })
  .strict()
  .superRefine((purpose, ctx) => {
	if (purpose.kind !== "webPreview") return;
	if (!readString(purpose.forNodeId)) {
	  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["forNodeId"], message: "webPreview requires forNodeId" });
	}
	if (!readString(purpose.sectionId)) {
	  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sectionId"], message: "webPreview requires sectionId" });
	}
	if (typeof purpose.order !== "number") {
	  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["order"], message: "webPreview requires order" });
	}
	if (readString(purpose.slotId)) {
	  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slotId"], message: "webPreview uses sectionId; slotId is reserved for webPageAsset" });
	}
  });

export const AgentImageGenerateToCanvasArgsSchema = z
  .object({
    outputKey: z.string().min(1),
    label: z.string().min(1),
    prompt: z.string().min(1),
    negativePrompt: z.string().optional(),
    systemPrompt: z.string().optional(),
    aspectRatio: z.string().optional(),
    resolution: ImageResolutionSchema.optional(),
    references: z.array(AgentMediaReferenceSchema).optional(),
    sourceEvidence: z.array(z.string().min(1)).optional(),
    cameraControl: JsonObjectSchema.optional(),
    lightingRig: JsonObjectSchema.optional(),
    shotNo: z.number().int().positive().optional(),
    purpose: AgentImagePurposeSchema.optional(),
  })
  .strict();

export const AgentVideoGenerateToCanvasArgsSchema = z
  .object({
    outputKey: z.string().min(1),
    label: z.string().min(1),
    prompt: z.string().min(1),
    negativePrompt: z.string().optional(),
    aspectRatio: z.string().optional(),
    resolution: VideoResolutionSchema.optional(),
    durationSeconds: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    references: z.array(AgentMediaReferenceSchema).min(1),
    audioMode: AudioModeSchema.optional(),
    returnLastFrame: z.boolean().optional(),
    sourceEvidence: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type AgentMediaReference = z.infer<typeof AgentMediaReferenceSchema>;
export type AgentImageGenerateToCanvasArgs = z.infer<typeof AgentImageGenerateToCanvasArgsSchema>;
export type AgentVideoGenerateToCanvasArgs = z.infer<typeof AgentVideoGenerateToCanvasArgsSchema>;

type DirectImageGenerateToCanvasArgs = z.infer<typeof DirectImageGenerateToCanvasArgsInputSchema>;
type DirectVideoGenerateToCanvasArgs = z.infer<typeof DirectVideoGenerateToCanvasArgsInputSchema>;

const STORYBOARD_IMAGE_REFERENCE_LIMIT = 3;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(key: string, value: unknown): Record<string, string> {
  const text = readString(value);
  return text ? { [key]: text } : {};
}

function normalizeReferenceRole(value: unknown): string {
  return readString(value);
}

function normalizeAnchorBindingKind(value: unknown): PublicFlowAnchorBindingKind {
  const role = normalizeReferenceRole(value).toLowerCase();
  for (const kind of PUBLIC_FLOW_ANCHOR_BINDING_KINDS) {
    if (kind === role) return kind;
  }
  return "asset";
}

function buildReferenceImages(references: AgentMediaReference[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    if (readString(reference.sourceNodeId) || readString(reference.assetId)) {
      continue;
    }
    const url = readString(reference.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function buildAssetInputs(references: AgentMediaReference[]) {
  return references.map((reference) => {
    const hasStableIdentity = Boolean(
      readString(reference.sourceNodeId) || readString(reference.assetId),
    );
    return {
      ...(!hasStableIdentity ? optionalStringField("url", reference.url) : {}),
      ...optionalStringField("sourceNodeId", reference.sourceNodeId),
      ...optionalStringField("assetId", reference.assetId),
      ...optionalStringField("assetRefId", reference.assetRefId),
      ...optionalStringField("role", reference.role),
      ...(typeof reference.weight === "number" ? { weight: reference.weight } : {}),
      ...(reference.relationshipKind ? { relationshipKind: reference.relationshipKind } : {}),
      ...optionalStringField("note", reference.note),
      ...optionalStringField("name", reference.name),
    };
  });
}

function buildAnchorBindings(references: AgentMediaReference[]) {
  return references
    .filter((reference) => readString(reference.sourceNodeId) || readString(reference.assetId) || readString(reference.assetRefId))
    .map((reference) => ({
      kind: normalizeAnchorBindingKind(reference.role),
      ...optionalStringField("sourceNodeId", reference.sourceNodeId),
      ...optionalStringField("assetId", reference.assetId),
      ...optionalStringField("assetRefId", reference.assetRefId),
      ...optionalStringField("label", reference.name),
      ...optionalStringField("note", reference.note),
      ...optionalStringField("category", reference.role),
      ...(typeof reference.weight === "number" ? { weight: reference.weight } : {}),
      ...(reference.relationshipKind ? { relationshipKind: reference.relationshipKind } : {}),
    }));
}

function isStoryboardImageRequest(args: AgentImageGenerateToCanvasArgs): boolean {
  const purposeKind = readString(args.purpose?.kind).toLowerCase();
  if (purposeKind === "storyboard") return true;
  const identityText = `${readString(args.outputKey)} ${readString(args.label)}`.toLowerCase();
  return (
    identityText.includes("storyboard") ||
    identityText.includes("故事板") ||
    identityText.includes("分镜")
  );
}

function limitStoryboardImageReferences(
  args: AgentImageGenerateToCanvasArgs,
): AgentMediaReference[] {
  const references = args.references ?? [];
  if (!isStoryboardImageRequest(args)) return references;
  return references.slice(0, STORYBOARD_IMAGE_REFERENCE_LIMIT);
}

function mapImagePurpose(purpose: AgentImageGenerateToCanvasArgs["purpose"]): Record<string, unknown> {
  if (!purpose) return {};
  if (purpose.kind === "webPreview") {
    return {
      ...optionalStringField("webPreviewForNodeId", purpose.forNodeId),
	  ...optionalStringField("webScreenshotSectionId", purpose.sectionId),
	  ...(typeof purpose.order === "number" ? { webScreenshotOrder: purpose.order } : {}),
    };
  }
  if (purpose.kind === "webPageAsset") {
    return {
      ...optionalStringField("webPageAssetForNodeId", purpose.forNodeId),
      ...optionalStringField("webPageAssetId", purpose.assetId),
      ...optionalStringField("webPageAssetSlotId", purpose.slotId),
      ...optionalStringField("webPageAssetSource", purpose.source),
      ...optionalStringField("webPageAssetRole", purpose.role),
      ...optionalStringField("webPageAssetCategory", purpose.category),
      ...optionalStringField("webPageAssetPlacement", purpose.placement),
      ...(purpose.requirement ? { webPageAssetRequirement: purpose.requirement } : {}),
      ...(typeof purpose.transparentPng === "boolean" ? { transparentPng: purpose.transparentPng } : {}),
    };
  }
  if (purpose.kind === "pptDeckImage") {
    return {
      ...optionalStringField("pptDeckImageForNodeId", purpose.forNodeId),
      ...(typeof purpose.slideIndex === "number" ? { pptDeckSlideIndex: purpose.slideIndex } : {}),
      ...optionalStringField("pptDeckSlideId", purpose.slideId),
    };
  }
  return {};
}

export function buildDirectImageGenerateToCanvasArgs(
  args: AgentImageGenerateToCanvasArgs,
): DirectImageGenerateToCanvasArgs {
  const references = limitStoryboardImageReferences(args);
  const referenceImages = buildReferenceImages(references);
  const assetInputs = buildAssetInputs(references);
  const anchorBindings = buildAnchorBindings(references);
  return DirectImageGenerateToCanvasArgsInputSchema.parse({
    node: {
      id: args.outputKey,
      type: "taskNode",
      data: {
        kind: referenceImages.length || assetInputs.length ? "imageEdit" : "image",
        label: args.label,
        prompt: args.prompt,
        ...optionalStringField("negativePrompt", args.negativePrompt),
        ...optionalStringField("systemPrompt", args.systemPrompt),
        ...optionalStringField("aspectRatio", args.aspectRatio),
        ...optionalStringField("resolution", args.resolution),
        ...(referenceImages.length ? { referenceImages } : {}),
        ...(assetInputs.length ? { assetInputs } : {}),
        ...(anchorBindings.length ? { anchorBindings } : {}),
        ...(args.sourceEvidence?.length ? { sourceEvidence: args.sourceEvidence } : {}),
        ...(args.cameraControl ? { imageCameraControl: args.cameraControl } : {}),
        ...(args.lightingRig ? { imageLightingRig: args.lightingRig } : {}),
        ...(typeof args.shotNo === "number" ? { shotNo: args.shotNo } : {}),
        ...mapImagePurpose(args.purpose),
      },
    },
  });
}

export function buildDirectVideoGenerateToCanvasArgs(
  args: AgentVideoGenerateToCanvasArgs,
): DirectVideoGenerateToCanvasArgs {
  const references = args.references;
  const referenceImages = buildReferenceImages(references);
  const assetInputs = buildAssetInputs(references);
  const anchorBindings = buildAnchorBindings(references);
  return DirectVideoGenerateToCanvasArgsInputSchema.parse({
    node: {
      id: args.outputKey,
      type: "taskNode",
      data: {
        kind: "video",
        label: args.label,
        prompt: args.prompt,
        ...optionalStringField("negativePrompt", args.negativePrompt),
        ...optionalStringField("aspectRatio", args.aspectRatio),
        ...optionalStringField("resolution", args.resolution),
        ...(typeof args.durationSeconds === "number" ? { durationSeconds: args.durationSeconds } : {}),
        ...(typeof args.seed === "number" ? { seed: args.seed } : {}),
        ...(args.audioMode ? { audioMode: args.audioMode === "withAudio" ? "with-audio" : args.audioMode } : {}),
        ...(typeof args.returnLastFrame === "boolean" ? { returnLastFrame: args.returnLastFrame } : {}),
        ...(referenceImages.length ? { referenceImages } : {}),
        ...(assetInputs.length ? { assetInputs } : {}),
        ...(anchorBindings.length ? { anchorBindings } : {}),
        ...(args.sourceEvidence?.length ? { sourceEvidence: args.sourceEvidence } : {}),
      },
    },
  });
}
