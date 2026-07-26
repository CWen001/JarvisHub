import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveRustfsConfig } from "../asset/rustfs.client";
import type { TaskKind } from "./task.schemas";
import { uploadInlineAssetBytesToRustfs } from "./task.inline-asset-utils";
import {
  readTrimmedString,
  type ExtractedImageAsset,
} from "./agents-tool-bridge.image-result";
import { webPageAssetRequiresTransparency } from "./webpage-asset-transparency";

export const GREEN_SCREEN_BACKGROUND_PROMPT =
  "solid pure green background, hex #00ff00";

export function appendGreenScreenBackgroundPrompt(prompt: string): string {
  const base = readTrimmedString(prompt);
  if (base.toLowerCase().includes(GREEN_SCREEN_BACKGROUND_PROMPT)) return base;
  return [
    base,
    "Transparent-background production constraint:",
    `Generate the subject on a ${GREEN_SCREEN_BACKGROUND_PROMPT}.`,
    "Keep the background flat, evenly lit, and shadow-free; do not use green in the subject, reflections, glow, glass tint, or edge details.",
    "The final system will remove this green background with HSV chroma keying and convert it to a real alpha PNG.",
  ].filter(Boolean).join("\n");
}

export function imageNodeRequestsTransparentPng(nodeData: Record<string, unknown>): boolean {
  if (webPageAssetRequiresTransparency(nodeData)) return true;
  if (nodeData.transparentPng === true) return true;
  const requirement = nodeData.webPageAssetRequirement;
  if (requirement && typeof requirement === "object" && !Array.isArray(requirement)) {
    const record = requirement as Record<string, unknown>;
    return record.transparentPng === true || record.requireTransparent === true;
  }
  return false;
}

function rgbToHsv(input: { r: number; g: number; b: number }): { h: number; s: number; v: number } {
  const r = input.r / 255;
  const g = input.g / 255;
  const b = input.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

function isGreenScreenPixel(r: number, g: number, b: number): boolean {
  const exactishGreen = g >= 145 && r <= 130 && b <= 130 && g - Math.max(r, b) >= 35;
  if (exactishGreen) return true;
  const hsv = rgbToHsv({ r, g, b });
  return hsv.h >= 80 && hsv.h <= 160 && hsv.s >= 0.35 && hsv.v >= 0.45 && g > r && g > b;
}

export function imageObjectStorageConfigured(c: AppContext): boolean {
  const env = c.env as Record<string, unknown>;
  const read = (key: string): string => {
    const value = env[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const accessKeyId = read("R2_ACCESS_KEY_ID") || read("RUSTFS_ACCESS_KEY_ID");
  const secretAccessKey = read("R2_SECRET_ACCESS_KEY") || read("RUSTFS_SECRET_ACCESS_KEY");
  const endpoint = read("R2_BUCKET_URL") || read("R2_ENDPOINT_URL") || read("RUSTFS_ENDPOINT_URL");
  const bucket = read("R2_BUCKET") || read("RUSTFS_BUCKET");
  if (!accessKeyId || !secretAccessKey || !endpoint) return false;
  return Boolean(resolveRustfsConfig({
    ...c.env,
    R2_ACCESS_KEY_ID: read("R2_ACCESS_KEY_ID") || undefined,
    R2_SECRET_ACCESS_KEY: read("R2_SECRET_ACCESS_KEY") || undefined,
    R2_BUCKET_URL: read("R2_BUCKET_URL") || undefined,
    R2_ENDPOINT_URL: read("R2_ENDPOINT_URL") || undefined,
    R2_BUCKET: read("R2_BUCKET") || undefined,
    RUSTFS_ACCESS_KEY_ID: read("RUSTFS_ACCESS_KEY_ID") || undefined,
    RUSTFS_SECRET_ACCESS_KEY: read("RUSTFS_SECRET_ACCESS_KEY") || undefined,
    RUSTFS_ENDPOINT_URL: read("RUSTFS_ENDPOINT_URL") || undefined,
    RUSTFS_BUCKET: read("RUSTFS_BUCKET") || undefined,
  }) && (bucket || read("R2_BUCKET_URL")));
}

async function fetchImageBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const sourceUrl = readTrimmedString(url);
  if (!sourceUrl) {
    throw new AppError("图片持久化失败：源图片 URL 为空", {
      status: 502,
      code: "image_postprocess_source_url_missing",
    });
  }
  const response = await fetchImpl(sourceUrl, {
    method: "GET",
    headers: {
      accept: "image/png,image/webp,image/jpeg,image/*,*/*",
      "user-agent": "JarvisHub-GeneratedImagePostprocess/1.0",
    },
  });
  if (!response.ok) {
    throw new AppError("图片持久化失败：拉取源图片失败", {
      status: 502,
      code: "image_postprocess_fetch_failed",
      details: { sourceUrl, httpStatus: response.status },
    });
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
  };
}

function mimeTypeToExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "bin";
}

export async function keyGreenScreenToAlphaPng(input: {
  bytes: Uint8Array;
}): Promise<{ pngBytes: Uint8Array; keyedPixels: number; totalPixels: number }> {
  const mod = (await import("@napi-rs/canvas")) as unknown as {
    createCanvas?: (width: number, height: number) => {
      getContext: (type: "2d") => {
        drawImage: (image: unknown, x: number, y: number) => void;
        getImageData: (x: number, y: number, width: number, height: number) => {
          data: Uint8ClampedArray;
        };
        putImageData: (imageData: { data: Uint8ClampedArray }, x: number, y: number) => void;
      };
      toBuffer: (mimeType: "image/png") => Buffer;
    };
    loadImage?: (source: Buffer | Uint8Array | string) => Promise<{ width: number; height: number }>;
  };
  if (typeof mod.createCanvas !== "function" || typeof mod.loadImage !== "function") {
    throw new AppError("图片透明背景后处理不可用：缺少 canvas 解码能力", {
      status: 500,
      code: "image_postprocess_canvas_unavailable",
    });
  }

  const image = await mod.loadImage(Buffer.from(input.bytes));
  const canvas = mod.createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  const pixels = imageData.data;
  let keyedPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    if (!isGreenScreenPixel(r, g, b)) continue;
    pixels[index + 3] = 0;
    keyedPixels += 1;
  }
  context.putImageData(imageData, 0, 0);
  const pngBytes = new Uint8Array(canvas.toBuffer("image/png"));
  return {
    pngBytes,
    keyedPixels,
    totalPixels: image.width * image.height,
  };
}

export async function prepareGeneratedImageAssetForCanvas(input: {
  c: AppContext;
  requestUserId: string;
  asset: ExtractedImageAsset;
  nodeData: Record<string, unknown>;
  meta?: {
    taskKind?: TaskKind;
    prompt?: string | null;
    vendor?: string;
    modelKey?: string | null;
    taskId?: string | null;
  };
  fetchImpl?: typeof fetch;
}): Promise<{ asset: ExtractedImageAsset; metadata: Record<string, unknown> }> {
  const imageUrl = readTrimmedString(input.asset.imageUrl);
  if (!imageUrl) return { asset: input.asset, metadata: {} };

  if (!imageObjectStorageConfigured(input.c)) {
    return {
      asset: input.asset,
      metadata: {
        assetHosting: {
          status: "disabled",
          message: "Object storage is not fully configured; using vendor image URL directly. Required: access key, secret key, endpoint/bucket URL, and bucket.",
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }

  if (imageNodeRequestsTransparentPng(input.nodeData)) {
    const fetched = await fetchImageBytes(imageUrl, input.fetchImpl);
    const keyed = await keyGreenScreenToAlphaPng({ bytes: fetched.bytes });
    const hostedUrl = await uploadInlineAssetBytesToRustfs({
      c: input.c,
      userId: input.requestUserId,
      mimeType: "image/png",
      bytes: keyed.pngBytes,
      prefix: "gen/images",
    });
    return {
      asset: {
        ...input.asset,
        imageUrl: hostedUrl,
      },
      metadata: {
        assetHosting: {
          status: "ready",
          hostedAt: new Date().toISOString(),
          sourceUrl: imageUrl,
          transform: "green-screen-hsv-alpha-key",
        },
        transparentPng: true,
        transparentBackground: "yes",
        transparencyEvidence: "green-screen-hsv-keyed",
        backgroundRemoval: {
          method: "hsv_green_screen_key",
          sourceBackground: "#00ff00",
          outputMimeType: "image/png",
          keyedPixels: keyed.keyedPixels,
          totalPixels: keyed.totalPixels,
        },
      },
    };
  }

  const fetched = await fetchImageBytes(imageUrl, input.fetchImpl);
  const contentType = fetched.contentType.startsWith("image/")
    ? fetched.contentType
    : "image/png";
  const hostedUrl = await uploadInlineAssetBytesToRustfs({
    c: input.c,
    userId: input.requestUserId,
    mimeType: contentType,
    bytes: fetched.bytes,
    prefix: "gen/images",
  });

  return {
    asset: {
      imageUrl: hostedUrl,
      assetId: input.asset.assetId || null,
    },
    metadata: {
      assetHosting: {
        status: "ready",
        hostedAt: new Date().toISOString(),
        sourceUrl: imageUrl,
        sourceMimeType: contentType,
        sourceExtension: mimeTypeToExtension(contentType),
      },
    },
  };
}
