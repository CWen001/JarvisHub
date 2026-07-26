import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Readable } from "node:stream";

import type { AppEnv } from "../../types";
import {
	getPptMasterProjectsRoot,
	isPathInsideConfiguredProjectsRoot,
} from "./agents-tool-bridge.ppt-master-runtime";

const MIME: Record<string, string> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".pdf": "application/pdf",
	".md": "text/markdown; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

function mimeFor(file: string): string {
	return MIME[extname(file).toLowerCase()] || "application/octet-stream";
}

function serveFile(c: any, filePath: string) {
	if (!existsSync(filePath)) {
		return c.json({ error: "not_found" }, 404);
	}
	const stat = statSync(filePath);
	if (!stat.isFile()) {
		return c.json({ error: "not_a_file" }, 400);
	}
	const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
	c.header("Content-Type", mimeFor(filePath));
	c.header("Content-Length", String(stat.size));
	c.header("Cache-Control", "no-cache, must-revalidate");
	return c.body(stream);
}

export function resolvePublicPptMasterProjectAsset(relative: string): string {
	const projectsRoot = getPptMasterProjectsRoot();
	return resolve(join(projectsRoot, relative));
}

export function registerPublicPptMasterAssetRoutes(
	publicApiRouter: OpenAPIHono<AppEnv>,
) {
	// Accept multi-segment project paths (e.g. /ppt-master-projects/elon_musk_intro_cn_ppt169_20260622)
	publicApiRouter.get("/ppt-master/projects/*", (c) => {
		// Use new URL(c.req.url).pathname for reliable full path extraction across adapters.
		const pathname = new URL(c.req.url).pathname;
		const ctxPrefix = "/public/ppt-master/projects/";
		const idx = pathname.indexOf("/ppt-master/projects/");
		const relative = pathname.startsWith(ctxPrefix)
			? pathname.slice(ctxPrefix.length)
			: idx >= 0 ? pathname.slice(idx + "/ppt-master/projects/".length) : "";
		if (!relative || relative.includes("..")) {
			return c.json({ error: "bad_params" }, 400);
		}
		const candidate = resolvePublicPptMasterProjectAsset(relative);
		if (!isPathInsideConfiguredProjectsRoot(candidate)) {
			return c.json({ error: "forbidden" }, 403);
		}
		return serveFile(c, candidate);
	});

	publicApiRouter.get("/ppt-master/exports/*", (c) => {
		const pathname = new URL(c.req.url).pathname;
		const ctxPrefix = "/public/ppt-master/exports/";
		const idx = pathname.indexOf("/ppt-master/exports/");
		const relative = pathname.startsWith(ctxPrefix)
			? pathname.slice(ctxPrefix.length)
			: idx >= 0 ? pathname.slice(idx + "/ppt-master/exports/".length) : "";
		if (!relative || relative.includes("..")) {
			return c.json({ error: "bad_params" }, 400);
		}
		const candidate = resolvePublicPptMasterProjectAsset(relative);
		if (!isPathInsideConfiguredProjectsRoot(candidate)) {
			return c.json({ error: "forbidden" }, 403);
		}
		return serveFile(c, candidate);
	});
}
