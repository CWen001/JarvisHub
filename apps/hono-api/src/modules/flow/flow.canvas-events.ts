import IORedis from "ioredis";

export type CanvasMutationEvent = {
	flowId: string;
	updatedAt: string;
	source: string;
	nodeIds?: string[];
	sessionId?: string;
};

const CHANNEL_PREFIX = "canvas:flow:";

let publisherClient: IORedis | null = null;
let publisherClientUrl = "";

function getPublisherClient(redisUrl: string): IORedis | null {
	if (!redisUrl) return null;
	if (publisherClient && publisherClientUrl === redisUrl) {
		return publisherClient;
	}
	if (publisherClient) {
		void publisherClient.quit().catch(() => undefined);
		publisherClient = null;
		publisherClientUrl = "";
	}
	const client = new IORedis(redisUrl, {
		lazyConnect: true,
		enableAutoPipelining: true,
		enableOfflineQueue: false,
		maxRetriesPerRequest: 1,
		retryStrategy: () => null,
	});
	client.on("error", (err) => {
		console.error("[canvas-events] redis publisher error", {
			error: err instanceof Error ? err.message : String(err),
		});
	});
	publisherClient = client;
	publisherClientUrl = redisUrl;
	return client;
}

export function buildCanvasChannel(flowId: string): string {
	return `${CHANNEL_PREFIX}${flowId}:mutation`;
}

export async function publishCanvasMutation(
	redisUrl: string | undefined,
	event: CanvasMutationEvent,
): Promise<void> {
	const url = (redisUrl || "").trim();
	if (!url) return;
	const client = getPublisherClient(url);
	if (!client) return;
	try {
		if (String(client.status) !== "ready") {
			await client.connect();
		}
		const channel = buildCanvasChannel(event.flowId);
		const payload = JSON.stringify(event);
		await client.publish(channel, payload);
	} catch (err) {
		console.warn("[canvas-events] publish failed", {
			flowId: event.flowId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
