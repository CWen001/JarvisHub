/**
 * Routes for canvas snapshot export.
 *
 *   POST /flows/:id/snapshot/export
 *     body: { canvasInnerHtml, fontCss, canvasBounds: { x, y, width, height }, videoInlineThresholdBytes? }
 *     → SSE stream with progress events; final event "done" carries downloadToken
 *
 *   GET /flows/:id/snapshot/download/:token
 *     → streams the .html file with attachment disposition
 *
 * Auth: same JWT user must own the flow and own the token (token is
 * single-user scoped via in-memory map; restart loses pending tokens — fine
 * for the single-shot UX since the user is still on the page).
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile, stat, unlink } from "node:fs/promises";
import { authMiddleware } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import { getFlowForOwner } from "../flow/flow.repo";
import {
  runSnapshotPipeline,
  snapshotFilePath,
  type SnapshotProgressEvent,
} from "./snapshot.pipeline";

export const snapshotRouter = new Hono<AppEnv>();

snapshotRouter.use("*", authMiddleware);

type TokenEntry = { userId: string; flowId: string; expiresAt: number };
const tokenRegistry = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function pruneExpiredTokens(): void {
  const now = Date.now();
  for (const [token, entry] of tokenRegistry.entries()) {
    if (entry.expiresAt < now) {
      tokenRegistry.delete(token);
      void unlink(snapshotFilePath(token)).catch(() => {});
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type ParsedNodeMetaDownload = {
  label: string;
  url: string;
  filename?: string;
};

type ParsedNodeMetaPptSlide = {
  index: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  imageUrl?: string;
  svgUrl?: string;
  svgMarkup?: string;
  speakerNotes?: string;
};

type ParsedNodeMetaPptDeck = {
  format?: string;
  pptxUrl?: string;
  pptxFilename?: string;
  slides: ParsedNodeMetaPptSlide[];
};

type ParsedNodeMeta = {
  id: string;
  type?: string;
  kind?: string;
  label?: string;
  prompt?: string;
  imageUrl?: string;
  downloads?: ParsedNodeMetaDownload[];
  pptDeck?: ParsedNodeMetaPptDeck;
};

function readMetaStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function parseNodeMeta(value: unknown): ParsedNodeMeta[] {
  if (!Array.isArray(value)) return [];
  const out: ParsedNodeMeta[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const entry: ParsedNodeMeta = { id };
    const type = readMetaStr(raw.type);
    if (type) entry.type = type;
    const kind = readMetaStr(raw.kind);
    if (kind) entry.kind = kind;
    const label = readMetaStr(raw.label);
    if (label) entry.label = label;
    const prompt = readMetaStr(raw.prompt);
    if (prompt) entry.prompt = prompt;
    const imageUrl = readMetaStr(raw.imageUrl);
    if (imageUrl) entry.imageUrl = imageUrl;
    if (Array.isArray(raw.downloads)) {
      const downloads: ParsedNodeMetaDownload[] = [];
      for (const item of raw.downloads as unknown[]) {
        if (!isPlainObject(item)) continue;
        const url = readMetaStr(item.url);
        if (!url) continue;
        const label = readMetaStr(item.label) || "下载";
        const download: ParsedNodeMetaDownload = { label, url };
        const filename = readMetaStr(item.filename);
        if (filename) download.filename = filename;
        downloads.push(download);
        if (downloads.length >= 24) break;
      }
      if (downloads.length) entry.downloads = downloads;
    }
    if (isPlainObject(raw.pptDeck)) {
      const pd = raw.pptDeck as Record<string, unknown>;
      const slidesRaw = Array.isArray(pd.slides) ? (pd.slides as unknown[]) : [];
      const slides: ParsedNodeMetaPptSlide[] = [];
      for (let i = 0; i < slidesRaw.length && i < 60; i += 1) {
        const item = slidesRaw[i];
        if (!isPlainObject(item)) continue;
        const idxRaw = (item as Record<string, unknown>).index;
        const index = typeof idxRaw === "number" && Number.isFinite(idxRaw) ? idxRaw : i;
        const slide: ParsedNodeMetaPptSlide = { index };
        const title = readMetaStr(item.title);
        if (title) slide.title = title;
        const subtitle = readMetaStr(item.subtitle);
        if (subtitle) slide.subtitle = subtitle;
        const speakerNotes = readMetaStr(item.speakerNotes);
        if (speakerNotes) slide.speakerNotes = speakerNotes;
        const slideImageUrl = readMetaStr(item.imageUrl);
        if (slideImageUrl) slide.imageUrl = slideImageUrl;
        const slideSvgUrl = readMetaStr(item.svgUrl);
        if (slideSvgUrl) slide.svgUrl = slideSvgUrl;
        const slideSvgMarkup = readMetaStr(item.svgMarkup);
        if (slideSvgMarkup) slide.svgMarkup = slideSvgMarkup;
        if (Array.isArray(item.bullets)) {
          const bullets: string[] = [];
          for (const b of item.bullets as unknown[]) {
            const t = readMetaStr(b);
            if (t) bullets.push(t);
            if (bullets.length >= 8) break;
          }
          if (bullets.length) slide.bullets = bullets;
        }
        slides.push(slide);
      }
      const deck: ParsedNodeMetaPptDeck = { slides };
      const format = readMetaStr(pd.format);
      if (format) deck.format = format;
      const pptxUrl = readMetaStr(pd.pptxUrl);
      if (pptxUrl) deck.pptxUrl = pptxUrl;
      const pptxFilename = readMetaStr(pd.pptxFilename);
      if (pptxFilename) deck.pptxFilename = pptxFilename;
      if (deck.slides.length || deck.pptxUrl) entry.pptDeck = deck;
    }
    out.push(entry);
  }
  return out;
}

function parseBody(body: unknown): {
  ok: boolean;
  reason?: string;
  canvasInnerHtml?: string;
  fontCss?: string;
  pageCss?: string;
  canvasBounds?: { x: number; y: number; width: number; height: number };
  videoInlineThresholdBytes?: number;
  nodeMeta?: ParsedNodeMeta[];
} {
  if (!isPlainObject(body)) return { ok: false, reason: "body must be object" };
  const html = body.canvasInnerHtml;
  if (typeof html !== "string" || html.length === 0) {
    return { ok: false, reason: "canvasInnerHtml missing/empty" };
  }
  if (html.length > 10 * 1024 * 1024) {
    return { ok: false, reason: "canvasInnerHtml too large (>10MB)" };
  }
  const fontCss = typeof body.fontCss === "string" ? body.fontCss : "";
  const pageCss = typeof body.pageCss === "string" ? body.pageCss : "";
  if (pageCss.length > 10 * 1024 * 1024) {
    return { ok: false, reason: "pageCss too large (>10MB)" };
  }
  const bounds = body.canvasBounds;
  if (!isPlainObject(bounds)) return { ok: false, reason: "canvasBounds required" };
  const bx = Number(bounds.x), by = Number(bounds.y), bw = Number(bounds.width), bh = Number(bounds.height);
  if (![bx, by, bw, bh].every((n) => Number.isFinite(n))) {
    return { ok: false, reason: "canvasBounds.{x,y,width,height} must be finite" };
  }
  if (bw <= 0 || bh <= 0) {
    return { ok: false, reason: "canvasBounds.{width,height} must be > 0" };
  }
  let videoInlineThresholdBytes: number | undefined;
  if (typeof body.videoInlineThresholdBytes === "number" && body.videoInlineThresholdBytes > 0) {
    videoInlineThresholdBytes = body.videoInlineThresholdBytes;
  }
  const nodeMeta = parseNodeMeta(body.nodeMeta);
  return {
    ok: true,
    canvasInnerHtml: html,
    fontCss,
    pageCss,
    canvasBounds: { x: bx, y: by, width: bw, height: bh },
    videoInlineThresholdBytes,
    nodeMeta,
  };
}

snapshotRouter.post("/:id/snapshot/export", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const flowId = c.req.param("id");
  const flow = await getFlowForOwner(c.env.DB, flowId, userId);
  if (!flow) return c.json({ error: "Flow not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = parseBody(body);
  if (!parsed.ok) return c.json({ error: parsed.reason || "Bad request" }, 400);

  pruneExpiredTokens();

  return streamSSE(c, async (stream) => {
    let closed = false;
    const abortSignal = c.req.raw.signal as AbortSignal;
    abortSignal.addEventListener("abort", () => {
      closed = true;
    });

    const send = async (event: SnapshotProgressEvent): Promise<void> => {
      if (closed) return;
      const eventName =
        event.kind === "step"
          ? event.name
          : event.kind === "asset-progress"
            ? "asset-progress"
            : event.kind;
      const { kind: _kind, ...rest } = event as { kind: string } & Record<string, unknown>;
      void _kind;
      await stream.writeSSE({
        event: eventName,
        data: JSON.stringify(rest),
      });
    };

    try {
      await send({ kind: "step", name: "started", payload: { flowId } });
      const result = await runSnapshotPipeline(
        c,
        {
          flow,
          userId,
          canvasInnerHtml: parsed.canvasInnerHtml!,
          fontCss: parsed.fontCss!,
          pageCss: parsed.pageCss!,
          canvasBounds: parsed.canvasBounds!,
          videoInlineThresholdBytes: parsed.videoInlineThresholdBytes,
          nodeMeta: parsed.nodeMeta || [],
        },
        send,
      );
      tokenRegistry.set(result.downloadToken, {
        userId,
        flowId,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });
      await send({
        kind: "step",
        name: "done",
        payload: {
          downloadToken: result.downloadToken,
          bytes: result.bytes,
          failedCount: result.failedCount,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send({ kind: "error", message });
    } finally {
      try {
        await stream.close();
      } catch {
        // ignore
      }
    }
  });
});

snapshotRouter.get("/:id/snapshot/download/:token", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const flowId = c.req.param("id");
  const token = c.req.param("token");
  pruneExpiredTokens();
  const entry = tokenRegistry.get(token);
  if (!entry || entry.userId !== userId || entry.flowId !== flowId) {
    return c.json({ error: "Snapshot not found or expired" }, 404);
  }
  const filePath = snapshotFilePath(token);
  try {
    await stat(filePath);
  } catch {
    tokenRegistry.delete(token);
    return c.json({ error: "Snapshot file missing" }, 404);
  }
  const flow = await getFlowForOwner(c.env.DB, flowId, userId);
  const safeName = (flow?.name || "snapshot").replace(/[^\w一-龥._-]+/g, "_").slice(0, 80);
  // legacy filename="..." must be ASCII; CJK is carried via filename*=UTF-8''… (RFC 5987)
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, "") || "snapshot";
  const html = await readFile(filePath, "utf8");
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${asciiFallback}.html"; filename*=UTF-8''${encodeURIComponent(safeName)}.html`,
  );
  c.header("Cache-Control", "private, no-store");
  return c.body(html);
});
