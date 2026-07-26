import type { CanvasAgentToolExecutionInput } from '../api/server'

type ExecuteTool = (input: CanvasAgentToolExecutionInput) => Promise<Record<string, unknown>>

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readData(payload: Record<string, unknown>, toolName: string): Record<string, unknown> {
	if (!isRecord(payload.data)) throw new Error(`${toolName} 返回缺少 data`)
	return payload.data
}

function readExactIds(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const ids = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
	return ids.length === value.length && new Set(ids).size === ids.length ? ids : []
}

function splitExactChunks(value: string, maxChars = 7000): string[] {
	if (!value) throw new Error('WebHero transaction cannot stage empty code')
	const chunks: string[] = []
	for (let offset = 0; offset < value.length; offset += maxChars) {
		chunks.push(value.slice(offset, offset + maxChars))
	}
	return chunks
}

function randomSessionId(): string {
	return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? `webhero-runner-${crypto.randomUUID()}`
		: `webhero-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function shouldRetryCommitReceipt(error: unknown): boolean {
	if (isRecord(error) && typeof error.status === 'number') return error.status >= 500
	const message = error instanceof Error ? error.message : String(error || '')
	return /network|fetch|timeout|timed out|response lost|connection/i.test(message)
}

export type CommittedWebHeroCode = {
	updatedAt: string
	committedNodeData: Record<string, unknown>
	webHeroHtml: string
	webHeroCss: string
	webHeroDocumentHtml: string
	webHeroCodeSessionId: string
	webHeroCodeCommittedAt: string
}

export type WebHeroReadinessSnapshot = {
	flowUpdatedAt: string
	previewNodeIds: string[]
	codeInputDigest: string
}

export async function checkWebHeroCodeReadiness(input: {
	executeTool: ExecuteTool
	flowId: string
	nodeId: string
	projectId?: string | null
}): Promise<WebHeroReadinessSnapshot> {
	const readinessEnvelope = await input.executeTool({
		flowId: input.flowId,
		nodeId: input.nodeId,
		...(input.projectId ? { projectId: input.projectId } : {}),
		toolName: 'canvas_webhero_check_readiness',
		args: { nodeId: input.nodeId },
	})
	const readiness = readData(readinessEnvelope, 'canvas_webhero_check_readiness')
	const previewNodeIds = readExactIds(readiness.previewNodeIds)
	const flowUpdatedAt = typeof readiness.flowUpdatedAt === 'string' ? readiness.flowUpdatedAt.trim() : ''
	const codeInputDigest = typeof readiness.codeInputDigest === 'string' ? readiness.codeInputDigest.trim() : ''
	if (readiness.ready !== true || !flowUpdatedAt || !/^sha256:[a-f0-9]{64}$/.test(codeInputDigest) || previewNodeIds.length < 3 || previewNodeIds.length > 4) {
		const missing = Array.isArray(readiness.missing) ? readiness.missing.join(', ') : ''
		throw new Error(`WebHero readiness 未通过${missing ? `：${missing}` : ''}`)
	}
	return { flowUpdatedAt, previewNodeIds, codeInputDigest }
}

export async function commitGeneratedWebHeroCode(input: {
	executeTool: ExecuteTool
	flowId: string
	nodeId: string
	projectId?: string | null
	html: string
	css: string
	sessionId?: string
	expectedCodeInputDigest?: string
}): Promise<CommittedWebHeroCode> {
	const base = {
		flowId: input.flowId,
		nodeId: input.nodeId,
		...(input.projectId ? { projectId: input.projectId } : {}),
	}
	const { flowUpdatedAt, previewNodeIds, codeInputDigest } = await checkWebHeroCodeReadiness({
		executeTool: input.executeTool,
		flowId: input.flowId,
		nodeId: input.nodeId,
		projectId: input.projectId,
	})
	if (input.expectedCodeInputDigest && input.expectedCodeInputDigest !== codeInputDigest) {
		throw new Error('WebHero codegen inputs changed after runner preflight; refusing to commit stale generated code')
	}

	const sessionId = input.sessionId || randomSessionId()
	for (const [field, value] of [['html', input.html], ['css', input.css]] as const) {
		const chunks = splitExactChunks(value)
		for (const [index, chunk] of chunks.entries()) {
			await input.executeTool({
				...base,
				toolName: 'canvas_webhero_code_stage_raw_chunk',
				args: {
					nodeId: input.nodeId,
					sessionId,
					flowUpdatedAt,
					previewNodeIds,
					codeInputDigest,
					field,
					index,
					total: chunks.length,
					chunk,
				},
			})
		}
	}

	let commitEnvelope: Record<string, unknown>
	try {
		commitEnvelope = await input.executeTool({
			...base,
			toolName: 'canvas_webhero_code_commit',
			args: { nodeId: input.nodeId, sessionId },
		})
	} catch (error) {
		if (!shouldRetryCommitReceipt(error)) throw error
		commitEnvelope = await input.executeTool({
			...base,
			toolName: 'canvas_webhero_code_commit',
			args: { nodeId: input.nodeId, sessionId },
		})
	}
	const commit = readData(commitEnvelope, 'canvas_webhero_code_commit')
	const committedNodeData = isRecord(commit.committedNodeData) ? commit.committedNodeData : null
	const updatedAt = typeof commit.updatedAt === 'string' ? commit.updatedAt.trim() : ''
	const committed = {
		updatedAt,
		committedNodeData: committedNodeData || {},
		webHeroHtml: typeof committedNodeData?.webHeroHtml === 'string' ? committedNodeData.webHeroHtml : '',
		webHeroCss: typeof committedNodeData?.webHeroCss === 'string' ? committedNodeData.webHeroCss : '',
		webHeroDocumentHtml: typeof committedNodeData?.webHeroDocumentHtml === 'string' ? committedNodeData.webHeroDocumentHtml : '',
		webHeroCodeSessionId: typeof committedNodeData?.webHeroCodeSessionId === 'string' ? committedNodeData.webHeroCodeSessionId : '',
		webHeroCodeCommittedAt: typeof committedNodeData?.webHeroCodeCommittedAt === 'string' ? committedNodeData.webHeroCodeCommittedAt : '',
	}
	if (
		committed.webHeroHtml !== input.html
		|| committed.webHeroCss !== input.css
		|| !committed.webHeroDocumentHtml
		|| committed.webHeroCodeSessionId !== sessionId
		|| !committed.webHeroCodeCommittedAt
		|| !committed.updatedAt
		|| !committedNodeData
		|| committedNodeData.webHeroHtml !== committed.webHeroHtml
		|| committedNodeData.webHeroCss !== committed.webHeroCss
		|| committedNodeData.webHeroDocumentHtml !== committed.webHeroDocumentHtml
		|| committedNodeData.webHeroCodeSessionId !== committed.webHeroCodeSessionId
		|| committedNodeData.webHeroCodeCommittedAt !== committed.webHeroCodeCommittedAt
	) {
		throw new Error('WebHero commit response did not prove the exact staged transaction')
	}
	return committed
}
