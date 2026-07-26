import { z } from "zod";

import {
  PUBLIC_FLOW_REFERENCE_RELATIONSHIP_KINDS,
} from "../flow/flow.anchor-bindings";
import {
  PublicFlowAnchorBindingSchema,
  optionalNonEmptyString,
} from "../flow/flow.public.schemas";

export const DIRECT_IMAGE_NODE_KIND_VALUES = ["image", "imageEdit"] as const;
export const DIRECT_VIDEO_NODE_KIND_VALUES = ["video"] as const;

const finiteNumber = z.number().finite();

const DirectMediaAssetInputSchema = z
  .object({
    url: optionalNonEmptyString,
    sourceNodeId: optionalNonEmptyString,
    assetId: optionalNonEmptyString,
    assetRefId: optionalNonEmptyString,
    role: optionalNonEmptyString,
    weight: finiteNumber.optional(),
    relationshipKind: z.enum(PUBLIC_FLOW_REFERENCE_RELATIONSHIP_KINDS).optional(),
    note: z.string().optional(),
    name: z.string().optional(),
  })
  .strict()
  .superRefine((reference, ctx) => {
    if (reference.sourceNodeId || reference.assetId || reference.url) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset input requires sourceNodeId, assetId, or an external url; assetRefId is metadata only",
    });
  });

const ImageCameraControlInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    presetId: optionalNonEmptyString,
    azimuthDeg: finiteNumber.optional(),
    elevationDeg: finiteNumber.optional(),
    distance: finiteNumber.optional(),
  })
  .strict();

const ImageLightControlInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    presetId: optionalNonEmptyString,
    azimuthDeg: finiteNumber.optional(),
    elevationDeg: finiteNumber.optional(),
    intensity: finiteNumber.optional(),
    colorHex: optionalNonEmptyString,
  })
  .strict();

const ImageLightingRigInputSchema = z
  .object({
    main: ImageLightControlInputSchema.optional(),
    fill: ImageLightControlInputSchema.optional(),
  })
  .strict();

const JsonObjectInputSchema = z.record(z.unknown());

const ImageResolutionInputSchema = z.enum(["1K", "2K", "4K"]);

const DirectMediaNodeDataCommonSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  systemPrompt: z.string().optional(),
  aspectRatio: z.string().optional(),
  referenceImages: z.array(z.string().min(1)).optional(),
  assetInputs: z.array(DirectMediaAssetInputSchema).optional(),
  anchorBindings: z.array(PublicFlowAnchorBindingSchema).optional(),
  sourceEvidence: z.array(z.string().min(1)).optional(),
});

const DirectImageNodeDataExtraSchema = z.object({
  resolution: ImageResolutionInputSchema.optional(),
  webPreviewForNodeId: optionalNonEmptyString,
	webScreenshotSectionId: optionalNonEmptyString,
	webScreenshotOrder: z.number().int().positive().optional(),
  webPageAssetForNodeId: optionalNonEmptyString,
  webPageAssetId: z.string().optional(),
  webPageAssetSlotId: z.string().optional(),
  webPageAssetSource: z.string().optional(),
  webPageAssetRole: z.string().optional(),
  webPageAssetCategory: z.string().optional(),
  webPageAssetPlacement: z.string().optional(),
  webPageAssetRequirement: JsonObjectInputSchema.optional(),
  pptDeckImageForNodeId: optionalNonEmptyString,
  pptDeckSlideIndex: finiteNumber.optional(),
  pptDeckSlideId: optionalNonEmptyString,
  transparentPng: z.boolean().optional(),
  imageCameraControl: ImageCameraControlInputSchema.optional(),
  imageLightingRig: ImageLightingRigInputSchema.optional(),
  shotNo: finiteNumber.optional(),
});

const DirectVideoNodeDataExtraSchema = z.object({
  resolution: z.string().optional(),
  durationSeconds: finiteNumber.optional(),
  seed: finiteNumber.optional(),
  audioMode: z.string().optional(),
  returnLastFrame: z.boolean().optional(),
});

export const DirectImageNodeDataInputSchema = DirectMediaNodeDataCommonSchema
  .merge(DirectImageNodeDataExtraSchema)
  .extend({
    kind: z.enum(DIRECT_IMAGE_NODE_KIND_VALUES),
  })
	.strict()
	.superRefine((data, ctx) => {
		if (!data.webPreviewForNodeId) return;
		if (!data.webScreenshotSectionId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["webScreenshotSectionId"],
				message: "WebHero preview requires webScreenshotSectionId",
			});
		}
		if (typeof data.webScreenshotOrder !== "number") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["webScreenshotOrder"],
				message: "WebHero preview requires webScreenshotOrder",
			});
		}
	});

export const DirectVideoNodeDataInputSchema = DirectMediaNodeDataCommonSchema
  .merge(DirectVideoNodeDataExtraSchema)
  .extend({
    kind: z.enum(DIRECT_VIDEO_NODE_KIND_VALUES),
  })
  .strict();

const DirectMediaTaskNodeBaseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("taskNode"),
});

export const DirectImageTaskNodeInputSchema = DirectMediaTaskNodeBaseSchema.extend({
  data: DirectImageNodeDataInputSchema,
}).strict();

export const DirectVideoTaskNodeInputSchema = DirectMediaTaskNodeBaseSchema.extend({
  data: DirectVideoNodeDataInputSchema,
}).strict();

export const DirectImageGenerateToCanvasArgsInputSchema = z.object({
  node: DirectImageTaskNodeInputSchema,
}).strict();

export const DirectVideoGenerateToCanvasArgsInputSchema = z.object({
  node: DirectVideoTaskNodeInputSchema,
}).strict();
