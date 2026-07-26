import type { AppContext } from "../../types";
import type { TaskRequestDto } from "../task/task.schemas";
import { normalizeDispatchVendor } from "../task/task.vendor";
import { listCatalogMappings } from "./model-catalog.repo";

export type ExecutableAssetTaskKind = Extract<
	TaskRequestDto["kind"],
	"text_to_image" | "image_edit" | "text_to_video" | "image_to_video"
>;

export type ExecutableCatalogKind = "image" | "video";

const DIRECT_EXECUTABLE_VENDORS_BY_TASK_KIND: Readonly<
	Record<ExecutableAssetTaskKind, readonly string[]>
> = {
	text_to_image: [
		"tuzi",
		"rightcode",
		"rightcode-draw",
		"apimart",
		"dreamina",
		"dreamina-cli",
		"qwen",
	],
	image_edit: [
		"tuzi",
		"rightcode",
		"rightcode-draw",
		"apimart",
	],
	text_to_video: [],
	image_to_video: ["apimart", "seedance-ark"],
};

function taskKindsForCatalogKind(
	kind: ExecutableCatalogKind,
): readonly ExecutableAssetTaskKind[] {
	return kind === "image"
		? ["text_to_image", "image_edit"]
		: ["text_to_video", "image_to_video"];
}

async function listMappedVendorKeysForTaskKinds(
	c: AppContext,
	taskKinds: readonly ExecutableAssetTaskKind[],
): Promise<Set<string>> {
	const mappedVendorKeys = new Set<string>();
	const rowsByTaskKind = await Promise.all(
		taskKinds.map(async (taskKind) =>
			listCatalogMappings(c.env.DB, {
				taskKind,
				enabled: true,
			}),
		),
	);
	for (const rows of rowsByTaskKind) {
		for (const row of rows) {
			const vendorKey = normalizeDispatchVendor(row.vendor_key);
			if (vendorKey) mappedVendorKeys.add(vendorKey);
		}
	}
	return mappedVendorKeys;
}

export function isExecutableAssetTaskKind(
	value: unknown,
): value is ExecutableAssetTaskKind {
	return (
		value === "text_to_image" ||
		value === "image_edit" ||
		value === "text_to_video" ||
		value === "image_to_video"
	);
}

export async function listExecutableVendorKeysForAssetTaskKind(
	c: AppContext,
	taskKind: ExecutableAssetTaskKind,
): Promise<Set<string>> {
	const executableVendorKeys = new Set<string>(
		DIRECT_EXECUTABLE_VENDORS_BY_TASK_KIND[taskKind],
	);
	const mappedVendorKeys = await listMappedVendorKeysForTaskKinds(c, [taskKind]);
	for (const vendorKey of mappedVendorKeys) {
		executableVendorKeys.add(vendorKey);
	}
	return executableVendorKeys;
}

export async function listExecutableVendorKeysForCatalogKind(
	c: AppContext,
	kind: ExecutableCatalogKind,
): Promise<Set<string>> {
	const executableVendorKeys = new Set<string>();
	const taskKinds = taskKindsForCatalogKind(kind);
	for (const taskKind of taskKinds) {
		for (const vendorKey of DIRECT_EXECUTABLE_VENDORS_BY_TASK_KIND[taskKind]) {
			executableVendorKeys.add(vendorKey);
		}
	}
	const mappedVendorKeys = await listMappedVendorKeysForTaskKinds(c, taskKinds);
	for (const vendorKey of mappedVendorKeys) {
		executableVendorKeys.add(vendorKey);
	}
	return executableVendorKeys;
}
