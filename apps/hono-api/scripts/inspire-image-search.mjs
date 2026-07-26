#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_LIMIT = 20;
const DEFAULT_REGION = "us-en";
const DEFAULT_SAFE_SEARCH = "1";

const SOURCE_QUERIES = {
  all: "",
  pinterest: "site:pinterest.com",
  dribbble: "site:dribbble.com",
  behance: "site:behance.net",
  design: "(site:pinterest.com OR site:dribbble.com OR site:behance.net)",
  competitors:
    "(site:mi.com OR site:fitbit.com OR site:whoop.com OR site:amazfit.com OR site:polar.com OR site:garmin.com)",
};

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: errorMessage(error) }, null, 2));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = toPositiveInteger(args.limit, DEFAULT_LIMIT);
  const source = args.source ?? "all";
  const region = args.region ?? DEFAULT_REGION;
  const safeSearch = args.safeSearch ?? DEFAULT_SAFE_SEARCH;
  const query = args.query.trim();
  const effectiveQuery = buildEffectiveQuery(query, source, args.site);

  const searchPage = await curlText(buildSearchPageUrl(effectiveQuery));
  const vqd = extractVqd(searchPage);
  const imagePayload = await curlText(buildImageApiUrl(effectiveQuery, vqd, region, safeSearch), {
    referer: buildSearchPageUrl(effectiveQuery),
  });
  const parsed = parseImagePayload(imagePayload);
  const results = parsed.results.map(normalizeImageResult).filter(isUsefulImageResult).slice(0, limit);
  const downloaded = args.downloadDir
    ? await downloadImages(results, path.resolve(process.cwd(), args.downloadDir))
    : [];

  if (args.urlsOnly === true) {
    for (const item of results) {
      console.log(item.imageUrl);
    }
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        query,
        effectiveQuery,
        source,
        count: results.length,
        downloadDir: args.downloadDir ? path.resolve(process.cwd(), args.downloadDir) : null,
        downloaded,
        next: typeof parsed.next === "string" ? parsed.next : null,
        results,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv) {
  const parsed = {
    queryParts: [],
    site: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed.queryParts.push(arg);
      continue;
    }

    if (arg === "--urls-only") {
      parsed.urlsOnly = true;
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = toCamelCase(rawKey);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    if (key === "site") {
      parsed.site.push(value);
      continue;
    }

    parsed[key] = value;
  }

  const query = parsed.queryParts.join(" ").trim();
  if (query.length === 0) {
    throw new Error(
      'Missing query. Example: node inspire-image-search.mjs "fitness tracker landing page" --source pinterest',
    );
  }

  return { ...parsed, query };
}

function buildEffectiveQuery(query, source, sites) {
  if (!Object.hasOwn(SOURCE_QUERIES, source)) {
    const supported = Object.keys(SOURCE_QUERIES).join(", ");
    throw new Error(`Unsupported source "${source}". Supported sources: ${supported}`);
  }

  const siteFilters = sites.map((site) => site.trim()).filter(Boolean).map((site) => `site:${site}`);
  if (siteFilters.length > 0) {
    return `${query} (${siteFilters.join(" OR ")})`;
  }

  const sourceFilter = SOURCE_QUERIES[source];
  return sourceFilter.length > 0 ? `${query} ${sourceFilter}` : query;
}

function buildSearchPageUrl(query) {
  const url = new URL("https://duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("iax", "images");
  url.searchParams.set("ia", "images");
  return url.toString();
}

function buildImageApiUrl(query, vqd, region, safeSearch) {
  const url = new URL("https://duckduckgo.com/i.js");
  url.searchParams.set("l", region);
  url.searchParams.set("o", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("vqd", vqd);
  url.searchParams.set("f", ",,,");
  url.searchParams.set("p", safeSearch);
  return url.toString();
}

async function curlText(url, options = {}) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
    "-A",
    "Mozilla/5.0 inspiration-image-search",
    "-H",
    "accept: text/html,application/json,text/plain,*/*",
  ];

  if (options.referer) {
    args.push("-e", options.referer);
  }

  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, {
      timeout: REQUEST_TIMEOUT_MS + 5000,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (error) {
    throw new Error(`curl failed for ${url}: ${errorMessage(error)}`);
  }
}

async function curlBytes(url, options = {}) {
  const args = [
    "-sS",
    "-L",
    "--max-time",
    String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
    "-A",
    "Mozilla/5.0 inspiration-image-search",
  ];

  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, {
      encoding: "buffer",
      timeout: REQUEST_TIMEOUT_MS + 5000,
      maxBuffer: 50 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (error) {
    throw new Error(`curl failed for ${url}: ${errorMessage(error)}`);
  }
}

async function downloadImages(results, outputDir, options = {}) {
  await mkdir(outputDir, { recursive: true });
  const downloaded = [];

  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    const extension = extensionFromImageResult(item);
    const fileName = `${String(index + 1).padStart(2, "0")}-${slugify(item.title || "image")}.${extension}`;
    const filePath = path.join(outputDir, fileName);

    try {
      const bytes = await curlBytes(item.imageUrl, options);
      await writeFile(filePath, bytes, { flag: "wx" });
      downloaded.push({ ok: true, imageUrl: item.imageUrl, filePath });
    } catch (error) {
      downloaded.push({ ok: false, imageUrl: item.imageUrl, error: errorMessage(error) });
    }
  }

  return downloaded;
}

function extractVqd(html) {
  const patterns = [
    /vqd="([^"]+)"/,
    /vqd=([^&"'\\\s]+)/,
    /"vqd":"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error("DuckDuckGo image token vqd was not found in the search page response");
}

function parseImagePayload(payload) {
  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed.results)) {
      throw new Error("response.results is not an array");
    }
    return parsed;
  } catch (error) {
    const preview = payload.slice(0, 500);
    throw new Error(`DuckDuckGo image API returned non-JSON or unexpected JSON: ${errorMessage(error)}; preview=${preview}`);
  }
}

function normalizeImageResult(item) {
  return {
    title: stringOrEmpty(item.title),
    pageUrl: stringOrEmpty(item.url),
    imageUrl: stringOrEmpty(item.image),
    thumbnailUrl: stringOrEmpty(item.thumbnail),
    width: numberOrNull(item.width),
    height: numberOrNull(item.height),
    source: stringOrEmpty(item.source),
    format: stringOrEmpty(item.encoding_format),
    discoveryDate: stringOrNull(item.discovery_date),
  };
}

function isUsefulImageResult(item) {
  return item.imageUrl.startsWith("http://") || item.imageUrl.startsWith("https://");
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toPositiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }
  return parsed;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extensionFromImageResult(item) {
  const fromFormat = normalizeExtension(item.format);
  if (fromFormat) {
    return fromFormat;
  }

  try {
    const pathname = new URL(item.imageUrl).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return normalizeExtension(match?.[1]) ?? "jpg";
  } catch {
    return "jpg";
  }
}

function normalizeExtension(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase().replace(/^jpg$/, "jpeg");
  if (["jpeg", "png", "webp", "gif"].includes(normalized)) {
    return normalized === "jpeg" ? "jpg" : normalized;
  }
  return null;
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "image";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
