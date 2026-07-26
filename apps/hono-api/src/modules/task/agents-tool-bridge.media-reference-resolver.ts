import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getAssetByIdForUser } from "../asset/asset.repo";
import { isHostedAssetUrl } from "../asset/asset.hosting";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import { getFlowForOwner, mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { PublicFlowGraphSchema } from "../flow/flow.public.schemas";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";

export type MediaReferenceInput = {
  sourceNodeId?: string;
  assetId?: string;
  assetRefId?: string;
  url?: string;
  role?: string;
  note?: string;
  name?: string;
  weight?: number;
  relationshipKind?: "primary" | "reference";
};

export type ResolvedMediaReferences = {
  latestRow: FlowRow | null;
  referenceImages: string[];
  assetInputs: MediaReferenceInput[];
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function looksLikeInternalGeneratedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^\/?(?:assets\/r2\/)?gen\//i.test(trimmed)) return true;
  try {
    return /\/(?:assets\/r2\/)?gen\//i.test(new URL(trimmed).pathname);
  } catch {
    return false;
  }
}

function resolveHostedStyleReferenceUrl(c: AppContext, value: string): string | null {
  if (!isHostedAssetUrl(c, value)) return null;
  try {
    const requestUrl = new URL(c.req.url);
    const publicBase = resolvePublicAssetBaseUrl(c);
    const trimmed = value.trim();
    const candidate = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : trimmed.startsWith("/")
        ? new URL(trimmed, requestUrl.origin)
        : new URL(trimmed, `${publicBase.replace(/\/+$/, "")}/`);
    const bases = [
      publicBase,
      `${requestUrl.origin}/assets/r2`,
      `${candidate.origin}/assets/r2`,
    ];
    const matches = bases.some((rawBase) => {
      if (!rawBase) return false;
      const base = new URL(rawBase);
      if (candidate.origin !== base.origin) return false;
      const basePath = base.pathname.replace(/\/+$/, "");
      const prefix = `${basePath}/`;
      if (!candidate.pathname.startsWith(prefix)) return false;
      const relativePath = candidate.pathname.slice(prefix.length);
      return /^gen\/style-references(?:\/|$)/i.test(relativePath);
    });
    return matches ? candidate.toString() : null;
  } catch {
    return null;
  }
}

function isExternalHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseAssetData(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readPrimaryImageResult(data: Record<string, unknown>): Record<string, unknown> | null {
  const results = Array.isArray(data.imageResults) ? data.imageResults : [];
  if (results.length === 0) return null;
  const rawIndex = typeof data.imagePrimaryIndex === "number" ? Math.trunc(data.imagePrimaryIndex) : 0;
  return readRecord(results[Math.max(0, Math.min(rawIndex, results.length - 1))]);
}

function readNodeAssetId(data: Record<string, unknown>): string {
  return readString(data.assetId) || readString(readPrimaryImageResult(data)?.assetId);
}

function readNodeImageUrl(data: Record<string, unknown>): string {
  return readString(data.imageUrl) || readString(readPrimaryImageResult(data)?.url);
}

async function resolveAssetUrl(input: {
  c: AppContext;
  requestUserId: string;
  assetId: string;
  referenceIndex: number;
}): Promise<string> {
  const row = await getAssetByIdForUser(input.c.env.DB, input.assetId, input.requestUserId);
  if (!row) {
    throw new AppError("Reference asset not found", {
      status: 404,
      code: "reference_asset_not_found",
      details: { referenceIndex: input.referenceIndex, assetId: input.assetId },
    });
  }
  const url = readString(parseAssetData(row.data)?.url);
  if (!url || !isHostedAssetUrl(input.c, url)) {
    throw new AppError("Reference asset is not persisted", {
      status: 409,
      code: "reference_source_not_persisted",
      details: { referenceIndex: input.referenceIndex, assetId: input.assetId },
    });
  }
  return url;
}

async function resolveSourceNodeReference(input: {
  c: AppContext;
  requestUserId: string;
  latestRow: FlowRow;
  sourceNodeId: string;
  referenceIndex: number;
}): Promise<{ url: string; assetId: string }> {
  const graph = PublicFlowGraphSchema.safeParse(
    sanitizeFlowDataForStorage(mapFlowRowToDto(input.latestRow).data ?? {}),
  );
  if (!graph.success) {
    throw new AppError("Flow data invalid", {
      status: 500,
      code: "flow_data_invalid",
      details: { issues: graph.error.issues },
    });
  }
  const node = graph.data.nodes
    .map(readRecord)
    .find((candidate) => readString(candidate?.id) === input.sourceNodeId);
  if (!node) {
    throw new AppError("Reference source node not found", {
      status: 404,
      code: "reference_source_node_not_found",
      details: { referenceIndex: input.referenceIndex, sourceNodeId: input.sourceNodeId },
    });
  }
  const data = readRecord(node.data) ?? {};
  const kind = readString(data.kind).toLowerCase();
  if (kind === "video" || kind === "audio" || kind === "subtitle" || kind === "text") {
    throw new AppError("Reference source node does not contain an image", {
      status: 409,
      code: "reference_source_media_invalid",
      details: { referenceIndex: input.referenceIndex, sourceNodeId: input.sourceNodeId, kind },
    });
  }
  const status = readString(data.status).toLowerCase();
  if (status && status !== "success" && status !== "succeeded") {
    throw new AppError("Reference source image is not ready", {
      status: 409,
      code: "reference_source_image_not_ready",
      details: { referenceIndex: input.referenceIndex, sourceNodeId: input.sourceNodeId, status },
    });
  }

  const assetId = readNodeAssetId(data);
  if (assetId) {
    const url = await resolveAssetUrl({
      c: input.c,
      requestUserId: input.requestUserId,
      assetId,
      referenceIndex: input.referenceIndex,
    });
    return { url, assetId };
  }

  const url = readNodeImageUrl(data);
  if (!url) {
    throw new AppError("Reference source image is not ready", {
      status: 409,
      code: "reference_source_image_not_ready",
      details: { referenceIndex: input.referenceIndex, sourceNodeId: input.sourceNodeId },
    });
  }
  if (!isHostedAssetUrl(input.c, url)) {
    throw new AppError("Reference source image is not persisted", {
      status: 409,
      code: "reference_source_not_persisted",
      details: { referenceIndex: input.referenceIndex, sourceNodeId: input.sourceNodeId },
    });
  }
  return { url, assetId: "" };
}

function pushUnique(values: string[], seen: Set<string>, value: string): void {
  if (!value || seen.has(value)) return;
  seen.add(value);
  values.push(value);
}

export async function resolveLatestMediaReferences(input: {
  c: AppContext;
  requestUserId: string;
  flowId: string;
  referenceImages: string[];
  assetInputs: MediaReferenceInput[];
}): Promise<ResolvedMediaReferences> {
  const hasStableReferences = input.assetInputs.some((reference) =>
    Boolean(readString(reference.sourceNodeId) || readString(reference.assetId)),
  );
  const latestRow = hasStableReferences
    ? await getFlowForOwner(input.c.env.DB, input.flowId, input.requestUserId)
    : null;
  if (hasStableReferences && !latestRow) {
    throw new AppError("Flow not found", {
      status: 404,
      code: "flow_not_found",
      details: { flowId: input.flowId },
    });
  }

  const referenceImages: string[] = [];
  const seenUrls = new Set<string>();
  const assetInputs: MediaReferenceInput[] = [];
  for (const [referenceIndex, reference] of input.assetInputs.entries()) {
    const sourceNodeId = readString(reference.sourceNodeId);
    const suppliedAssetId = readString(reference.assetId);
    const assetRefId = readString(reference.assetRefId);
    const suppliedUrl = readString(reference.url);
    let url = "";
    let assetId = suppliedAssetId;

    if (sourceNodeId) {
      const resolved = await resolveSourceNodeReference({
        c: input.c,
        requestUserId: input.requestUserId,
        latestRow: latestRow!,
        sourceNodeId,
        referenceIndex,
      });
      url = resolved.url;
      assetId = resolved.assetId || assetId;
    } else if (assetId) {
      url = await resolveAssetUrl({
        c: input.c,
        requestUserId: input.requestUserId,
        assetId,
        referenceIndex,
      });
    } else if (suppliedUrl) {
      const hostedStyleUrl = resolveHostedStyleReferenceUrl(input.c, suppliedUrl);
      if (
        !hostedStyleUrl
        && (isHostedAssetUrl(input.c, suppliedUrl) || looksLikeInternalGeneratedUrl(suppliedUrl))
      ) {
        throw new AppError("Internal reference requires a stable ID", {
          status: 400,
          code: "internal_reference_id_required",
          details: { referenceIndex },
        });
      }
      if (!hostedStyleUrl && !isExternalHttpUrl(suppliedUrl)) {
        throw new AppError("Reference URL is invalid", {
          status: 400,
          code: "reference_url_invalid",
          details: { referenceIndex },
        });
      }
      url = hostedStyleUrl || suppliedUrl;
    } else {
      throw new AppError("Asset reference cannot be resolved without sourceNodeId, assetId, or external URL", {
        status: 400,
        code: "reference_asset_ref_unresolvable",
        details: { referenceIndex, ...(assetRefId ? { assetRefId } : {}) },
      });
    }

    pushUnique(referenceImages, seenUrls, url);
    assetInputs.push({
      ...reference,
      url,
      ...(sourceNodeId ? { sourceNodeId } : {}),
      ...(assetId ? { assetId } : {}),
    });
  }

  // assetInputs preserve the Agent's ordered references and therefore drive
  // the vendor image-slot order. referenceImages is only a legacy/external
  // supplement and may add URLs that were not represented in assetInputs.
  for (const [referenceIndex, rawUrl] of input.referenceImages.entries()) {
    const url = readString(rawUrl);
    if (!url) continue;
    const hostedStyleUrl = resolveHostedStyleReferenceUrl(input.c, url);
    if (
      !hostedStyleUrl
      && (isHostedAssetUrl(input.c, url) || looksLikeInternalGeneratedUrl(url))
    ) {
      throw new AppError("Internal reference requires a stable ID", {
        status: 400,
        code: "internal_reference_id_required",
        details: { referenceIndex },
      });
    }
    if (!hostedStyleUrl && !isExternalHttpUrl(url)) {
      throw new AppError("Reference URL is invalid", {
        status: 400,
        code: "reference_url_invalid",
        details: { referenceIndex },
      });
    }
    pushUnique(referenceImages, seenUrls, hostedStyleUrl || url);
  }

  return { latestRow, referenceImages, assetInputs };
}
