import type { ToolHandler } from "./registry.js";
import { persistToolRetrievalRecord } from "./retrieval-store.js";

type FontRecommendation = {
  displayFont: string;
  bodyFont: string;
  fallbackStack: string;
  googleCssUrl: string;
  weights: number[];
  source: "fontfyi";
  rationale: string;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 45_000;
const FONTFYI_BASE = "https://fontfyi.com";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = readString(item);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function titleCaseSlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readFontName(value: unknown): string {
  if (typeof value === "string") return titleCaseSlug(value.trim());
  if (!isRecord(value)) return "";
  return (
    readString(value.family) ||
    readString(value.name) ||
    titleCaseSlug(readString(value.slug)) ||
    readString(value.font)
  );
}

function cssFamilyParam(family: string, weights: number[]): string {
  const name = family.trim().replace(/\s+/g, "+");
  const uniqueWeights = Array.from(new Set(weights)).sort((a, b) => a - b);
  return uniqueWeights.length ? `family=${name}:wght@${uniqueWeights.join(";")}` : `family=${name}`;
}

export function buildGoogleFontsCssUrl(displayFont: string, bodyFont: string, weights: number[]): string {
  const families = [displayFont, bodyFont].filter((font, index, fonts) => font && fonts.indexOf(font) === index);
  const params = families.map((family) => cssFamilyParam(family, weights));
  params.push("display=swap");
  return `https://fonts.googleapis.com/css2?${params.join("&")}`;
}

function fallbackStackFor(displayFont: string, bodyFont: string): string {
  const display = displayFont ? `'${displayFont}'` : "var(--font-display)";
  const body = bodyFont ? `'${bodyFont}'` : "var(--font-body)";
  return `${display}, ${body}, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "CanvasAgents/1.0 font-search",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function collectFontNames(value: unknown, limit: number): string[] {
  const out: string[] = [];
  const push = (font: string): void => {
    if (font && !out.includes(font)) out.push(font);
  };
  const visit = (item: unknown): void => {
    if (out.length >= limit) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    const direct = readFontName(item);
    if (direct) push(direct);
    for (const key of ["font", "heading", "display", "body", "primary_font", "secondary_font", "heading_font", "body_font"]) {
      const name = readFontName(item[key]);
      if (name) push(name);
    }
    const results = item.results;
    if (Array.isArray(results)) visit(results);
  };
  visit(value);
  return out.slice(0, limit);
}

function buildRecommendations(input: {
  scenario: string;
  preferredDisplayFont: string;
  preferredBodyFont: string;
  searchPayload: unknown;
  pairingsPayload: unknown;
  limit: number;
}): FontRecommendation[] {
  const weights = [400, 500, 600, 700];
  const pairings = Array.isArray(input.pairingsPayload)
    ? input.pairingsPayload
    : isRecord(input.pairingsPayload) && Array.isArray(input.pairingsPayload.results)
      ? input.pairingsPayload.results
      : [];
  const recommendations: FontRecommendation[] = [];
  for (const item of pairings) {
    if (!isRecord(item)) continue;
    const displayFont = input.preferredDisplayFont || readFontName(item.heading) || readFontName(item.display) || readFontName(item.heading_font);
    const bodyFont = input.preferredBodyFont || readFontName(item.body) || readFontName(item.body_font) || readFontName(item.secondary);
    if (!displayFont || !bodyFont) continue;
    recommendations.push({
      displayFont,
      bodyFont,
      fallbackStack: fallbackStackFor(displayFont, bodyFont),
      googleCssUrl: buildGoogleFontsCssUrl(displayFont, bodyFont, weights),
      weights,
      source: "fontfyi",
      rationale: readString(item.rationale) || readString(item.description) || `Provider-ranked FontFYI pairing for ${input.scenario}.`,
    });
    if (recommendations.length >= input.limit) return recommendations;
  }

  const fontNames = collectFontNames(input.searchPayload, input.limit + 2);
  const displayFont = input.preferredDisplayFont || fontNames[0] || "";
  const bodyFont = input.preferredBodyFont || fontNames.find((font) => font !== displayFont) || "";
  if (displayFont && bodyFont) {
    recommendations.push({
      displayFont,
      bodyFont,
      fallbackStack: fallbackStackFor(displayFont, bodyFont),
      googleCssUrl: buildGoogleFontsCssUrl(displayFont, bodyFont, weights),
      weights,
      source: "fontfyi",
      rationale: `FontFYI search candidates for ${input.scenario}; first distinct display/body families selected by provider order.`,
    });
  }
  return recommendations.slice(0, input.limit);
}

export function createFontRecommendationSearchTool(): ToolHandler {
  return {
    definition: {
      name: "font_recommendation_search",
      description:
        "Search FontFYI and prepare a concrete web typography contract before website codegen. Use this when a generated site needs non-default display/body fonts, Google Fonts CSS URL, weights, fallback stack, and usage rationale.",
      parameters: {
        type: "object",
        properties: {
          scenario: {
            type: "string",
            description: "Design scenario or style, e.g. Awwwards cinematic electric vehicle launch, luxury editorial portfolio, playful SaaS dashboard.",
          },
          preferredDisplayFont: {
            type: "string",
            description: "Optional exact display font if the preview or user already named one.",
          },
          preferredBodyFont: {
            type: "string",
            description: "Optional exact body font if the preview or user already named one.",
          },
          limit: {
            type: "number",
            description: "Maximum recommendations to return. Default 8, max 20.",
          },
          timeoutMs: {
            type: "number",
            description: "Network timeout in milliseconds. Default 15000, max 45000.",
          },
        },
        required: ["scenario"],
        additionalProperties: false,
      },
    },
    async execute(args, ctx, toolCallId) {
      const scenario = readString(args.scenario);
      if (!scenario) throw new Error("font_recommendation_search scenario is required.");
      const preferredDisplayFont = readFontName(args.preferredDisplayFont);
      const preferredBodyFont = readFontName(args.preferredBodyFont);
      const limit = readPositiveInteger(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const searchUrl = `${FONTFYI_BASE}/api/v1/search/?q=${encodeURIComponent(scenario)}`;
      const pairingsUrl = `${FONTFYI_BASE}/api/v1/pairings/`;

      try {
        const [searchPayload, pairingsPayload] = await Promise.all([
          fetchJson(searchUrl, timeoutMs),
          fetchJson(pairingsUrl, timeoutMs),
        ]);
        const recommendations = buildRecommendations({
          scenario,
          preferredDisplayFont,
          preferredBodyFont,
          searchPayload,
          pairingsPayload,
          limit,
        });
        const selected = recommendations[0] ?? null;
        const contentPayload = {
          ok: recommendations.length > 0,
          provider: "fontfyi",
          scenario,
          searchUrl,
          pairingsUrl,
          resultCount: recommendations.length,
          selected,
          recommendations,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            fontPlanRule:
              "Store selected.displayFont/bodyFont/googleCssUrl under webPageImplementationBrief.fontPlan.namedFonts and css import plan before final codegen.",
            codegenRule:
              "Final source must import googleCssUrl or equivalent @import, expose --font-display/--font-body, and apply display font to hero headings, section titles, nav mark, and metric numerals.",
          },
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "font_recommendation_search",
          query: scenario,
          source: "fontfyi",
          resultCount: recommendations.length,
          payload: contentPayload,
        });
        return { toolCallId, content: JSON.stringify({ ...contentPayload, retrievalRecord }) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const contentPayload = {
          ok: false,
          provider: "fontfyi",
          scenario,
          searchUrl,
          pairingsUrl,
          resultCount: 0,
          selected: null,
          recommendations: [],
          error: message,
          usageContract: {
            retrievalRecordPath: "retrievalRecord.id",
            failureRule:
              "Do not silently fall back to default fonts after this failure. Store the retrieval id and retry or ask for explicit font names.",
          },
        };
        const retrievalRecord = await persistToolRetrievalRecord(ctx, {
          kind: "font_recommendation_search",
          query: scenario,
          source: "fontfyi",
          resultCount: 0,
          payload: contentPayload,
        });
        return { toolCallId, content: JSON.stringify({ ...contentPayload, retrievalRecord }) };
      }
    },
  };
}
