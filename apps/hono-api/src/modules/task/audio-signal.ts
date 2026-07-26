const SILENT_PATTERNS: RegExp[] = [
	/静音/,
	/无声/,
	/无配音/,
	/不要配音/,
	/不要声音/,
	/不要音频/,
	/\bsilent\b/i,
	/\bmute\b/i,
	/\bno\s+audio\b/i,
	/\bwithout\s+audio\b/i,
];

export function detectSilentSignal(text: string | null | undefined): boolean {
	if (typeof text !== "string" || !text) return false;
	return SILENT_PATTERNS.some((p) => p.test(text));
}
