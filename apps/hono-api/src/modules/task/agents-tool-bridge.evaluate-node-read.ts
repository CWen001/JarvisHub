import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import type { FlowRow } from "../flow/flow.repo";
import { mapFlowRowToDto } from "../flow/flow.repo";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export type EvaluateNodeMediaEntry =
  | {
      kind: "image" | "video";
      url: string;
      role: string;
      sourceField: string;
    }
  | {
      kind: "text";
      text: string;
      role: string;
      sourceField: string;
    };

export type EvaluateNodeReadResult = {
  ok: true;
  flowId: string;
  nodeId: string;
  nodeType: string;
  nodeKind: string;
  label: string;
  status: string;
  prompt: string;
  items: EvaluateNodeMediaEntry[];
};

type EvaluateNodeReadInput = {
  c: AppContext;
  flowId: string;
  row: FlowRow;
  bodyArgs: Record<string, unknown>;
};

type FlowNodeLike = { id?: unknown; data?: unknown };

export function pickMediaFromNode(
  data: Record<string, unknown>,
  nodeKind: string,
  options?: { nodeId?: string; allNodes?: FlowNodeLike[] },
): EvaluateNodeMediaEntry[] {
  const items: EvaluateNodeMediaEntry[] = [];
  const seen = new Set<string>();

  const pushImage = (url: string, sourceField: string, role: string) => {
    const trimmed = readTrimmedString(url);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    items.push({ kind: "image", url: trimmed, role, sourceField });
  };

  const pushVideo = (url: string, sourceField: string, role: string) => {
    const trimmed = readTrimmedString(url);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    items.push({ kind: "video", url: trimmed, role, sourceField });
  };

  const pushText = (text: string, sourceField: string, role: string) => {
    const trimmed = readTrimmedString(text);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    items.push({ kind: "text", text: trimmed.slice(0, 12000), role, sourceField });
  };

  const normalizedKind = nodeKind.trim().toLowerCase();
  const isWebHero = normalizedKind === "webhero";
  const isWebPageDerivedNode =
    Boolean(readTrimmedString(data.webPreviewForNodeId)) ||
    Boolean(readTrimmedString(data.webPageAssetForNodeId));
  const status = readTrimmedString(data.status).toLowerCase();
  const hasTerminalMediaStatus =
    !status ||
    status === "success" ||
    status === "succeeded" ||
    status === "completed" ||
    status === "done";

  if (isWebPageDerivedNode) {
    // WebHero preview/asset nodes often keep historical imageResults and
    // generation referenceImages. Review/codegen evidence must be the current
    // successful node output only; otherwise stale results and style refs leak
    // into critic/codegen and can override the approved preview.
    if (hasTerminalMediaStatus) {
      const modelImageUrl =
        readTrimmedString(data.modelInputImageUrl) ||
        readTrimmedString(data.sourceImageUrl) ||
        readTrimmedString(data.imageUrl);
      pushImage(modelImageUrl, modelImageUrl === readTrimmedString(data.imageUrl) ? "data.imageUrl" : "data.modelInputImageUrl", "primary_image");
      pushImage(readTrimmedString(data.firstFrameUrl), "data.firstFrameUrl", "first_frame");
      pushImage(readTrimmedString(data.lastFrameUrl), "data.lastFrameUrl", "last_frame");
      pushVideo(readTrimmedString(data.videoUrl), "data.videoUrl", "primary_video");
    }
    pushText(readTrimmedString(data.content), "data.content", "content");
    pushText(readTrimmedString(data.text), "data.text", "text");
    pushText(readTrimmedString(data.markdown), "data.markdown", "markdown");
    pushText(readTrimmedString(data.script), "data.script", "script");
    pushText(readTrimmedString(data.body), "data.body", "body");
    return items;
  }

  if (normalizedKind === "pptdeck") {
    // A pptDeck node holds the deck brief/research and a `slides` outline; the
    // rendered per-slide images live in child `kind:"image"` nodes linked via
    // pptDeckImageForNodeId (mirroring WebHero preview children). Its own
    // slides[].imageUrl values are nodeId references, NOT URLs, so they must
    // never be pushed as image items. Without this branch, reading the deck for
    // image-generation context returns "no inspectable media" even though the
    // brief, research, per-slide visualBrief, and generated slide images are all
    // present in the flow graph.
    pushText(readTrimmedString(data.prompt), "data.prompt", "deck_prompt");
    pushText(readTrimmedString(data.systemPrompt), "data.systemPrompt", "system_prompt");
    pushText(readTrimmedString(data.pptResearch), "data.pptResearch", "research");

    if (Array.isArray(data.slides)) {
      const orderedSlides = data.slides
        .map((entry) => asRecord(entry))
        .filter((record): record is Record<string, unknown> => Boolean(record))
        .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
      for (const slide of orderedSlides) {
        const slideIndex = Number(slide.index);
        const label = Number.isFinite(slideIndex) ? `slide_${slideIndex}` : "slide";
        const bullets = Array.isArray(slide.bullets)
          ? slide.bullets.map((b) => readTrimmedString(b)).filter(Boolean)
          : [];
        const slideText = [
          readTrimmedString(slide.title),
          readTrimmedString(slide.subtitle),
          bullets.length > 0 ? bullets.map((b) => `- ${b}`).join("\n") : "",
          readTrimmedString(slide.speakerNotes),
          readTrimmedString(slide.visualBrief) ? `Visual: ${readTrimmedString(slide.visualBrief)}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        pushText(slideText, `data.slides[index=${slideIndex}]`, label);
      }
    }

    if (options?.nodeId && Array.isArray(options.allNodes)) {
      const parentId = options.nodeId;
      const slideImages: Array<{ url: string; sourceField: string; order: number }> = [];
      for (const node of options.allNodes) {
        const childData = asRecord(node?.data);
        if (!childData) continue;
        if (readTrimmedString(childData.pptDeckImageForNodeId) !== parentId) continue;
        const childStatus = readTrimmedString(childData.status).toLowerCase();
        if (childStatus && !(childStatus === "success" || childStatus === "succeeded" || childStatus === "completed" || childStatus === "done")) {
          continue;
        }
        const childUrl =
          readTrimmedString(childData.modelInputImageUrl) ||
          readTrimmedString(childData.sourceImageUrl) ||
          readTrimmedString(childData.imageUrl);
        if (!/^https?:\/\//i.test(childUrl)) continue;
        const orderRaw = Number(childData.pptDeckSlideIndex);
        slideImages.push({
          url: childUrl,
          sourceField: `childNode[${readTrimmedString(node?.id)}].imageUrl`,
          order: Number.isFinite(orderRaw) ? orderRaw : 9999,
        });
      }
      slideImages.sort((a, b) => a.order - b.order);
      for (const image of slideImages) {
        pushImage(image.url, image.sourceField, image.order < 9999 ? `slide_image_${image.order}` : "slide_image");
      }
    }

    return items;
  }

  const modelImageUrl =
    readTrimmedString(data.modelInputImageUrl) ||
    readTrimmedString(data.sourceImageUrl) ||
    readTrimmedString(data.imageUrl);
  pushImage(modelImageUrl, modelImageUrl === readTrimmedString(data.imageUrl) ? "data.imageUrl" : "data.modelInputImageUrl", "primary_image");
  if (Array.isArray(data.imageResults)) {
    data.imageResults.forEach((entry, index) => {
      const record = asRecord(entry);
      pushImage(readTrimmedString(record?.url), `data.imageResults[${index}].url`, "generated_image");
    });
  }
  pushImage(readTrimmedString(data.firstFrameUrl), "data.firstFrameUrl", "first_frame");
  pushImage(readTrimmedString(data.lastFrameUrl), "data.lastFrameUrl", "last_frame");

  pushVideo(readTrimmedString(data.videoUrl), "data.videoUrl", "primary_video");
  if (Array.isArray(data.videoResults)) {
    data.videoResults.forEach((entry, index) => {
      const record = asRecord(entry);
      pushVideo(readTrimmedString(record?.url), `data.videoResults[${index}].url`, "generated_video");
    });
  }

  if (!isWebHero && Array.isArray(data.referenceImages)) {
    data.referenceImages.forEach((entry, index) => {
      pushImage(readTrimmedString(entry), `data.referenceImages[${index}]`, "reference_image");
    });
  }

  if (!isWebHero && Array.isArray(data.assetInputs)) {
    data.assetInputs.forEach((entry, index) => {
      const record = asRecord(entry);
      const url = readTrimmedString(record?.url);
      const role = readTrimmedString(record?.role) || "asset_input";
      pushImage(url, `data.assetInputs[${index}].url`, role);
    });
  }

  pushText(readTrimmedString(data.content), "data.content", "content");
  pushText(readTrimmedString(data.text), "data.text", "text");
  pushText(readTrimmedString(data.markdown), "data.markdown", "markdown");
  pushText(readTrimmedString(data.script), "data.script", "script");
  pushText(readTrimmedString(data.body), "data.body", "body");

  if (normalizedKind === "text" || normalizedKind === "scriptdoc" || normalizedKind === "noveldoc") {
    pushText(readTrimmedString(data.prompt), "data.prompt", "prompt");
    pushText(readTrimmedString(data.systemPrompt), "data.systemPrompt", "system_prompt");
  }

  // WebHero parents own preview screenshots and resolved asset nodes via child
  // taskNodes with webPreviewForNodeId / webPageAssetForNodeId. Without this
  // expansion, calling canvas_read_node_media_for_context with the webHero id
  // returns "no inspectable media" even though all visual evidence is in the
  // flow graph — the agent then proceeds to write final code from prose alone.
  if (nodeKind === "webHero" && options?.nodeId && Array.isArray(options.allNodes)) {
    const parentId = options.nodeId;
    const childImages: Array<{ url: string; role: string; sourceField: string; order: number }> = [];
    for (const node of options.allNodes) {
      const childData = asRecord(node?.data);
      if (!childData) continue;
      const previewParent = readTrimmedString(childData.webPreviewForNodeId);
      const assetParent = readTrimmedString(childData.webPageAssetForNodeId);
      if (previewParent !== parentId && assetParent !== parentId) continue;
      const childId = readTrimmedString(node?.id);
      const childUrl =
        readTrimmedString(childData.modelInputImageUrl) ||
        readTrimmedString(childData.sourceImageUrl) ||
        readTrimmedString(childData.imageUrl);
      if (!childUrl) continue;
      const orderRaw = previewParent === parentId
        ? Number(childData.webScreenshotOrder)
        : 9999;
      const order = Number.isFinite(orderRaw) ? Number(orderRaw) : 9999;
      const role = previewParent === parentId
        ? `approved_preview${order && order < 9999 ? `_${order}` : ""}`
        : `resolved_asset:${readTrimmedString(childData.webPageAssetSlotId) || readTrimmedString(childData.webPageAssetId) || childId}`;
      childImages.push({
        url: childUrl,
        role,
        sourceField: `childNode[${childId}].${childUrl === readTrimmedString(childData.imageUrl) ? "imageUrl" : "modelInputImageUrl"}`,
        order: previewParent === parentId ? order : 10000 + childImages.length,
      });
    }
    childImages.sort((a, b) => a.order - b.order);
    for (const child of childImages) {
      pushImage(child.url, child.sourceField, child.role);
    }
  }

  return items;
}

export async function evaluateNodeReadMedia(
  input: EvaluateNodeReadInput,
): Promise<EvaluateNodeReadResult> {
  const nodeId = readTrimmedString(input.bodyArgs.nodeId);
  if (!nodeId) {
    throw new AppError("nodeId is required", {
      status: 400,
      code: "evaluate_node_node_id_required",
    });
  }
  const flowDto = mapFlowRowToDto(input.row);
  const graph = asRecord(flowDto.data);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const target = nodes
    .map((item) => asRecord(item))
    .find((record) => record && readTrimmedString(record.id) === nodeId);
  if (!target) {
    throw new AppError("Node not found", {
      status: 404,
      code: "evaluate_node_flow_node_not_found",
      details: { flowId: input.row.id, nodeId },
    });
  }
  const data = asRecord(target.data) ?? {};
  const type = readTrimmedString(target.type);
  const kind = readTrimmedString(data.kind);
  const items = pickMediaFromNode(data, kind, {
    nodeId,
    allNodes: nodes as FlowNodeLike[],
  });
  if (!items.length) {
    throw new AppError("Node has no inspectable media or text", {
      status: 422,
      code: "evaluate_node_media_missing",
      details: {
        flowId: input.row.id,
        nodeId,
        nodeType: type,
        nodeKind: kind,
        hint: "Trigger the upstream generation before evaluate_node, or pass a node with text content. Do not fabricate placeholder URLs.",
      },
    });
  }
  return {
    ok: true,
    flowId: input.row.id,
    nodeId,
    nodeType: type,
    nodeKind: kind,
    label: readTrimmedString(data.label),
    status: readTrimmedString(data.status),
    prompt: readTrimmedString(data.prompt) || readTrimmedString(data.systemPrompt),
    items,
  };
}
