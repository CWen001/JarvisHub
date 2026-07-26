export type ModelDefaults = {
	generateAudio?: boolean;
};

export function parseModelDefaults(rawMeta: string | null | undefined): ModelDefaults {
	if (typeof rawMeta !== "string" || !rawMeta.trim()) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawMeta);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const defaults = (parsed as Record<string, unknown>).defaults;
	if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return {};
	const out: ModelDefaults = {};
	const ga = (defaults as Record<string, unknown>).generateAudio;
	if (typeof ga === "boolean") out.generateAudio = ga;
	return out;
}
