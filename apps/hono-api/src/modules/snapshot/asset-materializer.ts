/**
 * Materialize asset URLs:
 *   - For images / audio / thumbnails: always inline as base64 data URI.
 *   - For videos < threshold: inline.
 *   - For videos >= threshold:
 *       - if hosted on our own R2/RustFS: keep external URL (永久).
 *       - else (short-lived signed upstream URLs, etc.): re-upload to R2 and return new URL.
 *
 * Failures do NOT bubble up — they are recorded as `failed` entries and the
 * pipeline continues. This complies with "no silent fallback" by surfacing
 * the failure list to the caller (and ultimately the HTML metadata).
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  createRustfsClient,
  resolveRustfsConfig,
  type RustfsConfig,
} from "../asset/rustfs.client";
import type { AppContext, WorkerEnv } from "../../types";
import type { AssetMediaKind, AssetRef } from "./asset-collector";

const FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_VIDEO_INLINE_THRESHOLD = 20 * 1024 * 1024; // 20 MB
const MAX_INLINE_BYTES_HARD_CAP = 50 * 1024 * 1024; // safety on individual asset

export type MaterializedAsset =
  | {
      ref: AssetRef;
      status: "inline";
      dataUri: string;
      mimeType: string;
      byteLength: number;
      /**
       * Stable short id (sha1-of-bytes) used to deduplicate identical inline
       * payloads across the exported HTML: the canvas DOM, the embedded
       * nodeMeta JSON, and per-node download chips often reference the same
       * remote URL multiple times. By emitting `data:asset/x-jh;id=<id>` tokens
       * at rewrite time and resolving them at runtime, we keep each payload
       * in the file exactly once.
       */
      assetId: string;
    }
  | {
      ref: AssetRef;
      status: "external";
      externalUrl: string;
      mimeType: string;
      byteLength: number;
    }
  | {
      ref: AssetRef;
      status: "failed";
      reason: string;
    };

export type MaterializeOptions = {
  videoInlineThresholdBytes?: number;
  /** ownerId — used as path prefix when re-hosting to R2 */
  userId: string;
};

function isOwnHostedUrl(url: string, storage: RustfsConfig | null): boolean {
  if (!storage) return false;
  if (storage.publicBase && url.startsWith(`${storage.publicBase}/`)) return true;
  try {
    const u = new URL(url);
    if (storage.endpoint) {
      const ep = new URL(storage.endpoint);
      if (u.hostname === ep.hostname) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function detectExtFromMime(mime: string): string {
  const slash = mime.indexOf("/");
  if (slash < 0) return "bin";
  const sub = mime.slice(slash + 1).split(";")[0].trim().toLowerCase();
  if (!sub) return "bin";
  if (sub === "jpeg") return "jpg";
  if (sub === "quicktime") return "mov";
  return sub;
}

async function fetchBytesWithTimeout(url: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`upstream ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const mimeType =
      (res.headers.get("content-type") || "application/octet-stream")
        .split(";")[0]
        .trim() || "application/octet-stream";
    return { bytes, mimeType };
  } finally {
    clearTimeout(timer);
  }
}

// SVG files exported by ppt-master can reference images via relative paths like
// `../images/01_slide_image.png`. When inlining the SVG into an offline HTML
// snapshot those relative refs would 404. Resolve and inline them as data URIs
// against the SVG's own URL before returning the bytes to the caller.
/**
 * Replace every relative `<image href>` / `xlink:href` inside an SVG by a
 * resolved URL (typically a `data:asset/x-jh;id=<id>` placeholder produced by
 * the surrounding pipeline). When `resolveHref` returns null we leave the
 * original href intact so the SVG can still be inspected manually later.
 */
export async function inlineSvgRelativeImages(
  svgText: string,
  baseUrl: string,
  resolveHref?: (absoluteUrl: string) => Promise<string | null>,
): Promise<string> {
  const hrefRe = /\b(href|xlink:href)\s*=\s*("|')([^"']+)(\2)/gi;
  const matches: Array<{ href: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(svgText)) !== null) {
    const rawHref = m[3] || "";
    if (!rawHref) continue;
    if (rawHref.startsWith("data:") || rawHref.startsWith("blob:")) continue;
    if (/^https?:\/\//i.test(rawHref)) continue;
    if (rawHref.startsWith("#")) continue;
    matches.push({ href: rawHref });
  }
  if (matches.length === 0) return svgText;
  const replacements = new Map<string, string>();
  for (const ref of matches) {
    if (replacements.has(ref.href)) continue;
    try {
      const absolute = new URL(ref.href, baseUrl).toString();
      // Default behavior: fetch the bytes and inline as a self-contained
      // data URI. Callers that have an asset registry available should pass
      // `resolveHref` to dedupe instead.
      let resolved: string | null = null;
      if (resolveHref) {
        resolved = await resolveHref(absolute);
      }
      if (!resolved) {
        const fetched = await fetchBytesWithTimeout(absolute);
        resolved = `data:${fetched.mimeType};base64,${Buffer.from(fetched.bytes).toString("base64")}`;
      }
      replacements.set(ref.href, resolved);
    } catch {
      // If we can't resolve a sub-asset, leave the original href in place.
      replacements.set(ref.href, ref.href);
    }
  }
  let out = svgText;
  for (const [href, dataUri] of replacements.entries()) {
    if (dataUri === href) continue;
    // Replace href="<original>" and href='<original>' and xlink:href.
    out = out.split(`"${href}"`).join(`"${dataUri}"`);
    out = out.split(`'${href}'`).join(`'${dataUri}'`);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid String.fromCharCode(...bytes) (stack overflow on large buffers).
  // Buffer is available in Node runtime; this module only runs server-side.
  return Buffer.from(bytes).toString("base64");
}

async function rehostToR2(
  c: AppContext,
  storage: RustfsConfig,
  bytes: Uint8Array,
  mimeType: string,
  userId: string,
): Promise<string> {
  const client = createRustfsClient(c.env);
  const ext = detectExtFromMime(mimeType);
  const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
  const now = new Date();
  const datePrefix = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const key = `snapshots/user/${safeUser}/${datePrefix}/${crypto.randomUUID()}.${ext}`;
  await client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: bytes,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
      ContentLength: bytes.byteLength,
    }),
  );
  const publicBase = (storage.publicBase || "").replace(/\/+$/, "");
  return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

function decideInline(kind: AssetMediaKind, byteLength: number, threshold: number): boolean {
  if (byteLength > MAX_INLINE_BYTES_HARD_CAP) return false;
  if (kind === "image" || kind === "audio" || kind === "thumbnail") return true;
  // "binary" (e.g. PPTX): never inline. Always keep as an external URL or
  // rehosted permanent URL so the offline viewer can pull the file on
  // demand instead of bloating the HTML with megabytes of base64.
  if (kind === "binary") return false;
  // video
  return byteLength < threshold;
}

export async function materializeAsset(
  c: AppContext,
  ref: AssetRef,
  options: MaterializeOptions,
): Promise<MaterializedAsset> {
  const threshold =
    typeof options.videoInlineThresholdBytes === "number" &&
    options.videoInlineThresholdBytes > 0
      ? options.videoInlineThresholdBytes
      : DEFAULT_VIDEO_INLINE_THRESHOLD;

  const storage = resolveRustfsConfig(c.env as WorkerEnv);

  let bytes: Uint8Array;
  let mimeType: string;
  try {
    const fetched = await fetchBytesWithTimeout(ref.url);
    bytes = fetched.bytes;
    mimeType = fetched.mimeType;
    if (mimeType.startsWith("image/svg")) {
      try {
        const svgText = new TextDecoder("utf-8").decode(bytes);
        const inlined = await inlineSvgRelativeImages(svgText, ref.url);
        if (inlined !== svgText) {
          bytes = new TextEncoder().encode(inlined);
        }
      } catch {
        // Leave the SVG as-is if relative-image inlining fails.
      }
    }
  } catch (err) {
    return {
      ref,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const shouldInline = decideInline(ref.mediaKind, bytes.byteLength, threshold);
  if (shouldInline) {
    const assetId = createHash("sha1").update(bytes).digest("base64url").slice(0, 12);
    return {
      ref,
      status: "inline",
      dataUri: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      mimeType,
      byteLength: bytes.byteLength,
      assetId,
    };
  }

  // External: keep URL if our own host, otherwise rehost to R2 for permanence.
  if (isOwnHostedUrl(ref.url, storage)) {
    return {
      ref,
      status: "external",
      externalUrl: ref.url,
      mimeType,
      byteLength: bytes.byteLength,
    };
  }

  if (!storage) {
    // No object storage configured.
    // For "binary" assets (PPTX) we MUST NOT inline as base64: that would
    // bloat the offline HTML by tens or hundreds of MB and turn the page
    // unrenderable. Keep the original URL — the offline viewer's download
    // chip will at least open it if the server is still reachable.
    if (ref.mediaKind === "binary") {
      return {
        ref,
        status: "external",
        externalUrl: ref.url,
        mimeType,
        byteLength: bytes.byteLength,
      };
    }
    // For media we'd normally want to inline (images/audio/etc.), fall back to
    // inline despite size — that path is bounded by MAX_INLINE_BYTES_HARD_CAP.
    const assetId = createHash("sha1").update(bytes).digest("base64url").slice(0, 12);
    return {
      ref,
      status: "inline",
      dataUri: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      mimeType,
      byteLength: bytes.byteLength,
      assetId,
    };
  }

  try {
    const newUrl = await rehostToR2(c, storage, bytes, mimeType, options.userId);
    return {
      ref,
      status: "external",
      externalUrl: newUrl,
      mimeType,
      byteLength: bytes.byteLength,
    };
  } catch (err) {
    return {
      ref,
      status: "failed",
      reason: `rehost failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function materializeAssetsConcurrent(
  c: AppContext,
  refs: AssetRef[],
  options: MaterializeOptions,
  onEach?: (index: number, total: number, result: MaterializedAsset) => void,
): Promise<MaterializedAsset[]> {
  const concurrency = 4;
  const results: MaterializedAsset[] = new Array(refs.length);
  let cursor = 0;
  let completed = 0;
  const total = refs.length;

  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < concurrency; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= refs.length) return;
          const result = await materializeAsset(c, refs[i]!, options);
          results[i] = result;
          completed += 1;
          if (onEach) onEach(completed, total, result);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}
