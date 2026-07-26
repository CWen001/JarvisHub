export type ZipEntrySource =
	| { path: string; bytes: Uint8Array; contentType?: string }
	| { path: string; stream: ReadableStream<Uint8Array>; contentType?: string };

type CentralDirectoryEntry = {
	pathBytes: Uint8Array;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
};

const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_FLAGS = ZIP_FLAG_DATA_DESCRIPTOR | ZIP_FLAG_UTF8;
const ZIP_VERSION_NEEDED = 20;
const ZIP_VERSION_MADE_BY = 20;
const ZIP_METHOD_STORE = 0;
const UINT32_MAX = 0xffffffff;

const textEncoder = new TextEncoder();

const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function updateCrc32State(state: number, bytes: Uint8Array): number {
	let c = state >>> 0;
	for (const byte of bytes) {
		c = CRC32_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	}
	return c >>> 0;
}

function finalizeCrc32State(state: number): number {
	return (state ^ UINT32_MAX) >>> 0;
}

export function crc32Bytes(bytes: Uint8Array): number {
	return finalizeCrc32State(updateCrc32State(UINT32_MAX, bytes));
}

function assertUint32(value: number, label: string): number {
	if (!Number.isFinite(value) || value < 0 || value > UINT32_MAX) {
		throw new Error(`${label} exceeds ZIP32 limit`);
	}
	return value >>> 0;
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
	out[offset] = value & 0xff;
	out[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
	const v = assertUint32(value, "uint32");
	out[offset] = v & 0xff;
	out[offset + 1] = (v >>> 8) & 0xff;
	out[offset + 2] = (v >>> 16) & 0xff;
	out[offset + 3] = (v >>> 24) & 0xff;
}

function buildLocalHeader(pathBytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(30 + pathBytes.byteLength);
	writeU32(out, 0, 0x04034b50);
	writeU16(out, 4, ZIP_VERSION_NEEDED);
	writeU16(out, 6, ZIP_FLAGS);
	writeU16(out, 8, ZIP_METHOD_STORE);
	writeU16(out, 10, 0);
	writeU16(out, 12, 0);
	writeU32(out, 14, 0);
	writeU32(out, 18, 0);
	writeU32(out, 22, 0);
	writeU16(out, 26, pathBytes.byteLength);
	writeU16(out, 28, 0);
	out.set(pathBytes, 30);
	return out;
}

function buildDataDescriptor(input: {
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
}): Uint8Array {
	const out = new Uint8Array(16);
	writeU32(out, 0, 0x08074b50);
	writeU32(out, 4, input.crc32);
	writeU32(out, 8, input.compressedSize);
	writeU32(out, 12, input.uncompressedSize);
	return out;
}

function buildCentralDirectoryHeader(entry: CentralDirectoryEntry): Uint8Array {
	const out = new Uint8Array(46 + entry.pathBytes.byteLength);
	writeU32(out, 0, 0x02014b50);
	writeU16(out, 4, ZIP_VERSION_MADE_BY);
	writeU16(out, 6, ZIP_VERSION_NEEDED);
	writeU16(out, 8, ZIP_FLAGS);
	writeU16(out, 10, ZIP_METHOD_STORE);
	writeU16(out, 12, 0);
	writeU16(out, 14, 0);
	writeU32(out, 16, entry.crc32);
	writeU32(out, 20, entry.compressedSize);
	writeU32(out, 24, entry.uncompressedSize);
	writeU16(out, 28, entry.pathBytes.byteLength);
	writeU16(out, 30, 0);
	writeU16(out, 32, 0);
	writeU16(out, 34, 0);
	writeU16(out, 36, 0);
	writeU32(out, 38, 0);
	writeU32(out, 42, entry.localHeaderOffset);
	out.set(entry.pathBytes, 46);
	return out;
}

function buildEndOfCentralDirectory(input: {
	entryCount: number;
	centralDirectorySize: number;
	centralDirectoryOffset: number;
}): Uint8Array {
	const out = new Uint8Array(22);
	writeU32(out, 0, 0x06054b50);
	writeU16(out, 4, 0);
	writeU16(out, 6, 0);
	writeU16(out, 8, input.entryCount);
	writeU16(out, 10, input.entryCount);
	writeU32(out, 12, input.centralDirectorySize);
	writeU32(out, 16, input.centralDirectoryOffset);
	writeU16(out, 20, 0);
	return out;
}

function normalizeZipPath(raw: string): string {
	return String(raw || "")
		.split("/")
		.map((part) => sanitizeZipPathPart(part))
		.filter(Boolean)
		.join("/");
}

async function* iterateEntries(
	entries: AsyncIterable<ZipEntrySource> | ZipEntrySource[],
): AsyncIterable<ZipEntrySource> {
	if (Array.isArray(entries)) {
		for (const entry of entries) yield entry;
		return;
	}
	for await (const entry of entries) yield entry;
}

async function enqueueEntryBody(
	controller: ReadableStreamDefaultController<Uint8Array>,
	entry: ZipEntrySource,
): Promise<{ crc32: number; size: number }> {
	let crcState = UINT32_MAX;
	let size = 0;
	const enqueueChunk = (chunk: Uint8Array): void => {
		if (!chunk.byteLength) return;
		crcState = updateCrc32State(crcState, chunk);
		size += chunk.byteLength;
		assertUint32(size, "entry size");
		controller.enqueue(chunk);
	};

	if ("bytes" in entry) {
		enqueueChunk(entry.bytes);
	} else {
		const reader = entry.stream.getReader();
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) enqueueChunk(value);
			}
		} finally {
			reader.releaseLock();
		}
	}

	return {
		crc32: finalizeCrc32State(crcState),
		size,
	};
}

export function sanitizeZipPathPart(input: string): string {
	const sanitized = String(input || "")
		.trim()
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.replace(/[\\/:"*?<>|]/g, "_")
		.replace(/\s+/g, " ")
		.replace(/\.+$/g, "")
		.trim();
	return sanitized || "untitled";
}

export function ensureUniqueZipPath(path: string, used: Map<string, number>): string {
	const normalized = normalizeZipPath(path) || "untitled";
	const count = used.get(normalized) ?? 0;
	used.set(normalized, count + 1);
	if (count === 0) return normalized;

	const slashIndex = normalized.lastIndexOf("/");
	const dotIndex = normalized.lastIndexOf(".");
	const hasExtension = dotIndex > slashIndex && dotIndex < normalized.length - 1;
	if (!hasExtension) return `${normalized}-${count + 1}`;
	return `${normalized.slice(0, dotIndex)}-${count + 1}${normalized.slice(dotIndex)}`;
}

export function createStoredZipStream(
	entries: AsyncIterable<ZipEntrySource> | ZipEntrySource[],
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const centralEntries: CentralDirectoryEntry[] = [];
			const usedPaths = new Map<string, number>();
			let offset = 0;

			try {
				for await (const entry of iterateEntries(entries)) {
					const path = ensureUniqueZipPath(entry.path, usedPaths);
					const pathBytes = textEncoder.encode(path);
					const localHeaderOffset = offset;
					const localHeader = buildLocalHeader(pathBytes);
					controller.enqueue(localHeader);
					offset += localHeader.byteLength;

					const body = await enqueueEntryBody(controller, entry);
					offset += body.size;

					const descriptor = buildDataDescriptor({
						crc32: body.crc32,
						compressedSize: body.size,
						uncompressedSize: body.size,
					});
					controller.enqueue(descriptor);
					offset += descriptor.byteLength;

					centralEntries.push({
						pathBytes,
						crc32: body.crc32,
						compressedSize: body.size,
						uncompressedSize: body.size,
						localHeaderOffset,
					});
				}

				const centralDirectoryOffset = offset;
				let centralDirectorySize = 0;
				for (const entry of centralEntries) {
					const centralHeader = buildCentralDirectoryHeader(entry);
					controller.enqueue(centralHeader);
					offset += centralHeader.byteLength;
					centralDirectorySize += centralHeader.byteLength;
				}

				const end = buildEndOfCentralDirectory({
					entryCount: centralEntries.length,
					centralDirectorySize,
					centralDirectoryOffset,
				});
				controller.enqueue(end);
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},
	});
}
