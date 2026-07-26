import { createClient } from "redis";
import { TaskBoard } from "./task-board.js";

export type CanvasSubscriptionHandle = {
	unsubscribe: () => Promise<void>;
};

type CanvasMutationEvent = {
	flowId: string;
	updatedAt: string;
	source: string;
	sessionId?: string;
};

const CHANNEL_PREFIX = "canvas:flow:";

function buildCanvasChannel(flowId: string): string {
	return `${CHANNEL_PREFIX}${flowId}:mutation`;
}

export async function subscribeToCanvasMutations(input: {
	redisUrl: string;
	flowId: string;
	ownSessionId?: string;
}): Promise<CanvasSubscriptionHandle | null> {
	const url = input.redisUrl.trim();
	if (!url || !input.flowId) return null;

	let subscriber: ReturnType<typeof createClient> | null = null;
	try {
		subscriber = createClient({ url });
		subscriber.on("error", (err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[canvas-subscription] redis error flowId=${input.flowId}: ${message}`);
		});
		await subscriber.connect();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[canvas-subscription] connect failed flowId=${input.flowId}: ${message}`);
		return null;
	}

	const channel = buildCanvasChannel(input.flowId);
	const activeSubscriber = subscriber;

	await activeSubscriber.subscribe(channel, (message: string) => {
		try {
			const event: CanvasMutationEvent = JSON.parse(message);
			if (input.ownSessionId && event.sessionId === input.ownSessionId) return;
			TaskBoard.recordExternalCanvasMutation(event.flowId, event.source);
		} catch {
			// ignore malformed messages
		}
	});

	console.info(`[canvas-subscription] subscribed channel=${channel}`);

	return {
		unsubscribe: async () => {
			try {
				await activeSubscriber.unsubscribe(channel);
				await activeSubscriber.quit();
			} catch {
				// ignore cleanup errors
			}
			console.info(`[canvas-subscription] unsubscribed channel=${channel}`);
		},
	};
}
