/**
 * Canonical image-asset contract for PPT Master SVG slides.
 *
 * A slide's persisted `imageUrl` is the only remote source. SVG authors place
 * that asset with PPT_SLIDE_IMAGE_PLACEHOLDER; this module downloads it once
 * during slide writing, stores it under project/images, rewrites only the
 * placeholder href, and validates every remaining image reference.
 *
 * Export is deliberately not part of this module's write path. It only calls
 * the read-only inspector before invoking the Python converter.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

import { AppError } from "../../middleware/error";
import {
	assertPptMasterSlideArtifactsOwned,
	isMaterializedPptMasterProject,
	type PptMasterSlideArtifact,
	validatePptMasterSlideSvgInput,
	validatePptMasterSvgMarkup,
} from "./agents-tool-bridge.ppt-master-runtime";

export const PPT_SLIDE_IMAGE_PLACEHOLDER = "{{PPT_SLIDE_IMAGE}}";

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const IMAGE_TAG_RE = /<(?:[A-Za-z_][\w.-]*:)?image\b[^>]*>/g;
const IMAGE_HREF_RE = /(?<![\w:-])(href|xlink:href)\s*=\s*(["'])(.*?)\2/g;

export type MaterializePptMasterSlideImageResult = {
	svgMarkup: string;
	localImagePath: string | null;
};

export type PptMasterSvgImageReferenceIssue = {
	file: string;
	href: string;
	reason: string;
};

type ImageReference = {
	href: string | null;
	reason?: string;
};

function supportedExtension(contentType: string): string | null {
	const normalized = contentType.toLowerCase().split(";", 1)[0]?.trim();
	if (normalized === "image/png") return ".png";
	if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
	if (normalized === "image/webp") return ".webp";
	if (normalized === "image/gif") return ".gif";
	return null;
}

function readImageReferences(svgMarkup: string): ImageReference[] {
	const references: ImageReference[] = [];
	const document = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
	const elements = document.getElementsByTagName("*");
	for (let index = 0; index < elements.length; index += 1) {
		const element = elements.item(index);
		if (!element) continue;
		const localName = element.localName || element.nodeName.split(":").pop() || "";
		const namespace = element.namespaceURI || "";
		if (localName !== "image" || (namespace && namespace !== SVG_NAMESPACE)) continue;

		const tagReferences: ImageReference[] = [];
		const href = element.getAttributeNode("href");
		if (href) tagReferences.push({ href: href.value });
		const xlinkHref = element.getAttributeNodeNS(XLINK_NAMESPACE, "href");
		if (xlinkHref) tagReferences.push({ href: xlinkHref.value });
		if (!tagReferences.length) {
			references.push({ href: null });
			continue;
		}
		references.push(...tagReferences);
		if (tagReferences.length > 1) {
			references.push({
				href: tagReferences.map((reference) => reference.href || "<empty>").join(" | "),
				reason: "image element has ambiguous href and xlink:href attributes",
			});
		}
	}
	return references;
}

function replaceSlideImagePlaceholders(svgMarkup: string, canonicalHref: string): string {
	IMAGE_TAG_RE.lastIndex = 0;
	return svgMarkup.replace(IMAGE_TAG_RE, (tag) => {
		IMAGE_HREF_RE.lastIndex = 0;
		return tag.replace(
			IMAGE_HREF_RE,
			(full, attribute: string, quote: string, href: string) => href === PPT_SLIDE_IMAGE_PLACEHOLDER
				? `${attribute}=${quote}${canonicalHref}${quote}`
				: full,
		);
	});
}

function isPathWithinProject(projectPath: string, candidate: string): boolean {
	const project = resolve(projectPath);
	const target = resolve(candidate);
	return target === project || target.startsWith(`${project}${sep}`);
}

function isProjectFile(projectPath: string, path: string): boolean {
	try {
		return statSync(path).isFile() &&
			isPathWithinProject(realpathSync(projectPath), realpathSync(path));
	} catch {
		return false;
	}
}

function assertMaterializedProject(projectPath: string): void {
	if (isMaterializedPptMasterProject(projectPath)) return;
	throw new AppError("PPT Master project is not materialized", {
		status: 409,
		code: "ppt_master_project_invalid",
		details: { projectPath },
	});
}

function assertSafeImagesDirectory(projectPath: string): string {
	const imagesDir = join(projectPath, "images");
	mkdirSync(imagesDir, { recursive: true });
	try {
		if (lstatSync(imagesDir).isSymbolicLink() ||
			!isPathWithinProject(realpathSync(projectPath), realpathSync(imagesDir))) {
			throw new Error("images directory resolves outside the project");
		}
	} catch (error) {
		throw new AppError("PPT Master images directory is unsafe", {
			status: 409,
			code: "ppt_master_project_invalid",
			details: {
				projectPath,
				imagesDir,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return imagesDir;
}

function decodeLocalHref(href: string): string | null {
	const pathOnly = href.split("?", 1)[0]!.split("#", 1)[0]!;
	try {
		return decodeURIComponent(pathOnly);
	} catch {
		return null;
	}
}

function inspectSvgMarkupImageReferences(input: {
	projectPath: string;
	fileName: string;
	svgMarkup: string;
	svgDir?: string;
	allowSlideImagePlaceholder?: boolean;
}): PptMasterSvgImageReferenceIssue[] {
	const projectPath = resolve(input.projectPath);
	const svgDir = input.svgDir ? resolve(input.svgDir) : join(projectPath, "svg_artifacts");
	const issues: PptMasterSvgImageReferenceIssue[] = [];

	for (const reference of readImageReferences(input.svgMarkup)) {
		const href = reference.href;
		if (reference.reason) {
			issues.push({ file: input.fileName, href: href || "", reason: reference.reason });
			continue;
		}
		if (href === null) {
			issues.push({ file: input.fileName, href: "", reason: "image element is missing href" });
			continue;
		}
		if (href.startsWith("data:image/")) continue;
		if (href.startsWith("data:")) {
			issues.push({ file: input.fileName, href, reason: "unsupported image data URI" });
			continue;
		}
		if (href === PPT_SLIDE_IMAGE_PLACEHOLDER) {
			if (input.allowSlideImagePlaceholder) continue;
			issues.push({ file: input.fileName, href, reason: "unresolved slide image placeholder" });
			continue;
		}
		if (/^https?:\/\//i.test(href)) {
			issues.push({ file: input.fileName, href, reason: "remote image references are not allowed" });
			continue;
		}
		if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
			issues.push({ file: input.fileName, href, reason: "image URI scheme is not allowed" });
			continue;
		}

		const decoded = decodeLocalHref(href);
		if (decoded === null) {
			issues.push({ file: input.fileName, href, reason: "image path is not valid URL encoding" });
			continue;
		}
		if (isAbsolute(decoded)) {
			issues.push({ file: input.fileName, href, reason: "absolute image paths are not allowed" });
			continue;
		}

		const primaryCandidate = resolve(svgDir, decoded);
		if (!isPathWithinProject(projectPath, primaryCandidate)) {
			issues.push({ file: input.fileName, href, reason: "image path escapes the PPT Master project" });
			continue;
		}

		const candidates = [
			primaryCandidate,
			resolve(projectPath, decoded),
			resolve(projectPath, "images", decoded),
			resolve(projectPath, "templates", decoded),
		].filter((candidate) => isPathWithinProject(projectPath, candidate));
		if (!candidates.some((candidate) => isProjectFile(projectPath, candidate))) {
			issues.push({ file: input.fileName, href, reason: "local image file not found" });
		}
	}

	return issues;
}

function throwInvalidReferences(
	projectPath: string,
	issues: ReadonlyArray<PptMasterSvgImageReferenceIssue>,
): never {
	throw new AppError("PPT Master SVG contains invalid image references", {
		status: 409,
		code: "ppt_master_svg_image_reference_invalid",
		details: { projectPath, issues },
	});
}

async function downloadSlideImage(
	imageUrl: string,
	context: { slideIndex: number; file: string },
): Promise<{ bytes: Buffer; extension: string }> {
	if (!/^https?:\/\//i.test(imageUrl)) {
		throw new AppError("PPT Master slide imageUrl must be an http(s) URL", {
			status: 409,
			code: "ppt_master_slide_image_download_failed",
			details: { ...context, imageUrl, reason: "imageUrl is not http(s)" },
		});
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
	try {
		const response = await fetch(imageUrl, { signal: controller.signal, redirect: "error" });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		const extension = supportedExtension(response.headers.get("content-type") || "");
		if (!extension) {
			throw new Error(`unsupported Content-Type: ${response.headers.get("content-type") || "missing"}`);
		}
		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
			throw new Error(`image exceeds ${MAX_DOWNLOAD_BYTES} byte limit`);
		}
		if (!response.body) throw new Error("empty response body");
		const reader = response.body.getReader();
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			totalBytes += chunk.value.byteLength;
			if (totalBytes > MAX_DOWNLOAD_BYTES) {
				controller.abort();
				await reader.cancel().catch(() => undefined);
				throw new Error(`image exceeds ${MAX_DOWNLOAD_BYTES} byte limit`);
			}
			chunks.push(Buffer.from(chunk.value));
		}
		const bytes = Buffer.concat(chunks, totalBytes);
		if (bytes.length === 0) throw new Error("empty response body");
		return { bytes, extension };
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError("Failed to materialize PPT Master slide image", {
			status: 502,
			code: "ppt_master_slide_image_download_failed",
			details: {
				...context,
				imageUrl,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	} finally {
		clearTimeout(timer);
	}
}

export async function materializePptMasterSlideImage(input: {
	projectPath: string;
	slideIndex: number;
	svgMarkup: string;
	imageUrl?: string | null;
}): Promise<MaterializePptMasterSlideImageResult> {
	const projectPath = resolve(input.projectPath);
	assertMaterializedProject(projectPath);
	const validatedSvg = validatePptMasterSlideSvgInput({
		slideIndex: input.slideIndex,
		svg: input.svgMarkup,
	});
	const slideIndex = validatedSvg.slideIndex;
	const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl.trim() : "";
	const svgMarkup = validatedSvg.svg;
	const references = readImageReferences(svgMarkup);
	const placeholderCount = references.filter((reference) => reference.href === PPT_SLIDE_IMAGE_PLACEHOLDER).length;
	const fileName = `${String(slideIndex).padStart(2, "0")}_slide.svg`;

	if (placeholderCount > 0 && !imageUrl) {
		throw new AppError("PPT Master slide SVG uses an image placeholder but slide.imageUrl is empty", {
			status: 409,
			code: "ppt_master_slide_image_url_missing",
			details: { slideIndex, file: fileName },
		});
	}
	if (imageUrl && placeholderCount === 0) {
		throw new AppError("PPT Master slide with imageUrl must place {{PPT_SLIDE_IMAGE}} in its SVG", {
			status: 409,
			code: "ppt_master_slide_image_placeholder_missing",
			details: { slideIndex, file: fileName },
		});
	}

	const preMaterializationIssues = inspectSvgMarkupImageReferences({
		projectPath,
		fileName,
		svgMarkup,
		allowSlideImagePlaceholder: placeholderCount > 0,
	});
	if (preMaterializationIssues.length) {
		throwInvalidReferences(projectPath, preMaterializationIssues);
	}

	if (!imageUrl) {
		return { svgMarkup, localImagePath: null };
	}

	const { bytes, extension } = await downloadSlideImage(imageUrl, {
		slideIndex,
		file: fileName,
	});
	const imagesDir = assertSafeImagesDirectory(projectPath);
	const digest = createHash("sha256").update(bytes).digest("hex");
	const localFile = `${String(slideIndex).padStart(2, "0")}_slide_image_${digest}${extension}`;
	const localImagePath = join(imagesDir, localFile);
	if (!existsSync(localImagePath)) {
		const tempImagePath = join(imagesDir, `.${localFile}.${randomUUID()}.tmp`);
		try {
			await writeFile(tempImagePath, bytes, { flag: "wx" });
			await rename(tempImagePath, localImagePath);
		} finally {
			await unlink(tempImagePath).catch(() => undefined);
		}
	}

	const canonicalHref = `../images/${localFile}`;
	const canonicalSvg = replaceSlideImagePlaceholders(svgMarkup, canonicalHref);
	const issues = inspectSvgMarkupImageReferences({
		projectPath,
		fileName,
		svgMarkup: canonicalSvg,
	});
	if (issues.length) throwInvalidReferences(projectPath, issues);
	return { svgMarkup: canonicalSvg, localImagePath };
}

export function inspectPptMasterSlideArtifacts(
	projectPathInput: string,
	artifacts: ReadonlyArray<PptMasterSlideArtifact>,
): PptMasterSvgImageReferenceIssue[] {
	const projectPath = resolve(projectPathInput);
	const ownedArtifacts = assertPptMasterSlideArtifactsOwned(projectPath, artifacts);
	const issues: PptMasterSvgImageReferenceIssue[] = [];
	for (const artifact of ownedArtifacts) {
		const fileName = basename(artifact.svgPath);
		const svgMarkup = readFileSync(artifact.svgPath, "utf8");
		try {
			validatePptMasterSvgMarkup(svgMarkup);
		} catch (error) {
			issues.push({
				file: fileName,
				href: "",
				reason: `invalid SVG: ${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}
		issues.push(...inspectSvgMarkupImageReferences({
			projectPath,
			fileName,
			svgMarkup,
			svgDir: dirname(artifact.svgPath),
		}));
	}
	return issues;
}

export function assertPptMasterSlideArtifactsValid(
	projectPath: string,
	artifacts: ReadonlyArray<PptMasterSlideArtifact>,
): void {
	assertMaterializedProject(resolve(projectPath));
	const issues = inspectPptMasterSlideArtifacts(projectPath, artifacts);
	if (issues.length) throwInvalidReferences(resolve(projectPath), issues);
}
