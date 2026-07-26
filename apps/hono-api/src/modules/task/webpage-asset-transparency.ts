import { AppError } from "../../middleware/error";

export type PngAlphaProbeResult =
  | { status: "alpha"; evidence: "png-alpha-probed" }
  | { status: "opaque"; evidence: "opaque-detected" }
  | { status: "unknown"; evidence: "unknown"; reason: string };

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function includesAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

export function parsePngAlpha(buffer: Uint8Array): boolean | null {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buffer.length < 33) return null;
  if (!pngSignature.every((value, index) => buffer[index] === value)) return null;
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) return true;

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length =
      (buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3];
    const type = String.fromCharCode(
      buffer[offset + 4],
      buffer[offset + 5],
      buffer[offset + 6],
      buffer[offset + 7],
    );
    if (type === "tRNS") return true;
    if (type === "IDAT") break;
    offset += 12 + Math.max(0, length);
  }
  return false;
}

function readPngChunkLength(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] ?? 0) << 24) |
    ((buffer[offset + 1] ?? 0) << 16) |
    ((buffer[offset + 2] ?? 0) << 8) |
    (buffer[offset + 3] ?? 0)
  ) >>> 0;
}

function pngHasCompleteImageData(buffer: Uint8Array): boolean {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buffer.length < 33) return false;
  if (!pngSignature.every((value, index) => buffer[index] === value)) return false;
  let offset = 8;
  let hasIdat = false;
  while (offset + 12 <= buffer.length) {
    const length = readPngChunkLength(buffer, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return false;
    const type = String.fromCharCode(
      buffer[offset + 4],
      buffer[offset + 5],
      buffer[offset + 6],
      buffer[offset + 7],
    );
    if (type === "IDAT") hasIdat = true;
    if (type === "IEND") return hasIdat;
    offset = chunkEnd;
  }
  return false;
}

async function parsePngEffectiveAlpha(buffer: Uint8Array): Promise<boolean | null> {
  const alphaCapable = parsePngAlpha(buffer);
  if (alphaCapable !== true) return alphaCapable;
  if (!pngHasCompleteImageData(buffer)) return true;
  try {
    const mod = (await import("@napi-rs/canvas")) as unknown as {
      createCanvas?: (width: number, height: number) => {
        getContext: (type: "2d") => {
          drawImage: (image: unknown, x: number, y: number) => void;
          getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray };
        };
      };
      loadImage?: (source: Buffer | Uint8Array | string) => Promise<{ width: number; height: number }>;
    };
    if (typeof mod.createCanvas !== "function" || typeof mod.loadImage !== "function") return true;
    const image = await mod.loadImage(Buffer.from(buffer));
    const canvas = mod.createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function webPageAssetRequiresTransparency(nodeData: Record<string, unknown>): boolean {
  if (!readTrimmedString(nodeData.webPageAssetForNodeId)) return false;
  const requirementRecord = readRecord(nodeData.webPageAssetRequirement);
  const requirementUsage = readRecord(requirementRecord.intendedWebUsage);
  const nodeUsage = readRecord(nodeData.intendedWebUsage);
  const intendedWebUsage =
    Object.keys(requirementUsage).length > 0 ? requirementUsage : nodeUsage;

  if (nodeData.transparentPng === false || requirementRecord.requireTransparent === false || requirementRecord.transparentPng === false) {
    return false;
  }

  if (nodeData.transparentPng === true || requirementRecord.requireTransparent === true || requirementRecord.transparentPng === true) {
    return true;
  }

  const text = [
    nodeData.webPageAssetId,
    nodeData.webPageAssetSlotId,
    nodeData.webPageAssetRole,
    nodeData.webPageAssetCategory,
    nodeData.webPageAssetPlacement,
    nodeData.label,
    nodeData.prompt,
    requirementRecord.assetId,
    requirementRecord.slotId,
    requirementRecord.subjectId,
    requirementRecord.subjectType,
    requirementRecord.role,
    requirementRecord.category,
    requirementRecord.type,
    requirementRecord.description,
    requirementRecord.reason,
    requirementRecord.placement,
    intendedWebUsage.backgroundTreatment,
    intendedWebUsage.layering,
    intendedWebUsage.interactionWithTypography,
  ].map(readTrimmedString).join(" ").toLowerCase();

  return includesAnyToken(text, [
    "transparent png",
    "transparent background",
    "alpha",
    "cutout",
    "isolated product",
    "isolated foreground",
    "foreground overlay",
  ]);
}

export async function validateWebPageAssetTransparency(input: {
  nodeId: string;
  nodeData: Record<string, unknown>;
  imageUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  if (!webPageAssetRequiresTransparency(input.nodeData)) return {};
  const imageUrl = readTrimmedString(input.imageUrl);
  if (!imageUrl) {
    throw new AppError("透明背景网页资产缺少图片 URL", {
      status: 502,
      code: "webpage_asset_transparency_url_missing",
      details: {
        nodeId: input.nodeId,
        webPageAssetForNodeId: readTrimmedString(input.nodeData.webPageAssetForNodeId) || null,
      },
    });
  }

  const alpha = await probePngAlpha(imageUrl, {
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });
  const checkedAt = new Date().toISOString();
  const transparency = {
    required: true,
    status: alpha.status,
    evidence: alpha.evidence,
    checkedAt,
    imageUrl,
    ...(alpha.status === "unknown" ? { reason: alpha.reason } : {}),
  };

  if (alpha.status !== "alpha") {
    throw new AppError("透明背景网页资产生成结果不是透明 PNG", {
      status: 422,
      code: "webpage_asset_transparency_required",
      details: {
        nodeId: input.nodeId,
        imageUrl,
        webPageAssetForNodeId: readTrimmedString(input.nodeData.webPageAssetForNodeId) || null,
        webPageAssetId: readTrimmedString(input.nodeData.webPageAssetId) || null,
        webPageAssetSlotId: readTrimmedString(input.nodeData.webPageAssetSlotId) || null,
        transparency,
        nextAction:
          "Regenerate this asset as a PNG cutout with real alpha; do not accept a rectangular background plate.",
      },
    });
  }

  return {
    transparentPng: true,
    transparentBackground: "yes",
    transparencyEvidence: alpha.evidence,
    webPageAssetTransparency: transparency,
  };
}

export function readWebPageAssetTransparencyErrorDetails(input: {
  nodeId: string;
  nodeData: Record<string, unknown>;
  imageUrl: string;
  probe: PngAlphaProbeResult;
}): Record<string, unknown> {
  const checkedAt = new Date().toISOString();
  return {
    nodeId: input.nodeId,
    imageUrl: readTrimmedString(input.imageUrl) || null,
    webPageAssetForNodeId: readTrimmedString(input.nodeData.webPageAssetForNodeId) || null,
    webPageAssetId: readTrimmedString(input.nodeData.webPageAssetId) || null,
    webPageAssetSlotId: readTrimmedString(input.nodeData.webPageAssetSlotId) || null,
    transparency: {
      required: true,
      status: input.probe.status,
      evidence: input.probe.evidence,
      checkedAt,
      imageUrl: readTrimmedString(input.imageUrl) || null,
      ...(input.probe.status === "unknown" ? { reason: input.probe.reason } : {}),
    },
  };
}

export async function probePngAlpha(url: string, options?: {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PngAlphaProbeResult> {
  const trimmed = String(url || "").trim();
  if (!trimmed) return { status: "unknown", evidence: "unknown", reason: "missing-url" };
  const fetchImpl = options?.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 4_000);
  try {
    const response = await fetchImpl(trimmed, {
      method: "GET",
      headers: {
        accept: "image/png,image/*,*/*",
        "user-agent": "JarvisHub-WebPageAssetTransparency/1.0",
        range: "bytes=0-65535",
      },
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) {
      return { status: "unknown", evidence: "unknown", reason: `http-${response.status}` };
    }
    const arrayBuffer = await response.arrayBuffer();
    const hasAlpha = await parsePngEffectiveAlpha(new Uint8Array(arrayBuffer));
    if (hasAlpha === true) return { status: "alpha", evidence: "png-alpha-probed" };
    if (hasAlpha === false) return { status: "opaque", evidence: "opaque-detected" };
    return { status: "unknown", evidence: "unknown", reason: "not-png-or-unreadable" };
  } catch (error) {
    return {
      status: "unknown",
      evidence: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
