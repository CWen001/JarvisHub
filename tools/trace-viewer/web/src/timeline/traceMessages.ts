export type TraceWireFormat = "responses" | "chat" | "gemini" | "bedrock" | "unknown";
export type TraceMessageRole = "system" | "user" | "assistant" | "tool";

export interface TraceToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface TraceMessage {
  role: TraceMessageRole;
  content: string;
  toolCalls: TraceToolCall[];
  toolCallId?: string;
  mediaCount?: number;
}

export interface TraceToolDefinition {
  name: string;
  description: string;
  parameters?: unknown;
}

export interface NormalizedTraceRequest {
  format: TraceWireFormat;
  messages: TraceMessage[];
  tools: TraceToolDefinition[];
  warning?: string;
}

export interface NormalizedTraceResponse {
  content: string;
  toolCalls: TraceToolCall[];
}

export interface RunTranscript extends NormalizedTraceRequest {
  pendingResponse: boolean;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function message(
  role: TraceMessageRole,
  content = "",
  options: Partial<Pick<TraceMessage, "toolCalls" | "toolCallId" | "mediaCount">> = {},
): TraceMessage {
  return {
    role,
    content,
    toolCalls: options.toolCalls ?? [],
    ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    ...(options.mediaCount ? { mediaCount: options.mediaCount } : {}),
  };
}

function appendMediaMarker(text: string, mediaCount: number): string {
  if (mediaCount === 0) return text;
  return `${text}${text ? "\n\n" : ""}[${mediaCount} inline image${mediaCount === 1 ? "" : "s"}]`;
}

function textAndMedia(value: unknown): { text: string; mediaCount: number } {
  if (typeof value === "string") return { text: value, mediaCount: 0 };
  if (!Array.isArray(value)) return { text: "", mediaCount: 0 };
  const text: string[] = [];
  let mediaCount = 0;
  for (const part of value) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string") text.push(part.text);
    else if (typeof part.content === "string") text.push(part.content);
    if (
      part.type === "input_image" ||
      part.type === "image_url" ||
      part.type === "image" ||
      isRecord(part.image_url)
    ) {
      mediaCount += 1;
    }
  }
  return { text: text.join(""), mediaCount };
}

function normalizeResponsesTools(body: Record<string, any>): TraceToolDefinition[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools
    .filter(isRecord)
    .map((tool) => ({
      name: asString(tool.name),
      description: asString(tool.description),
      ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
    }));
}

function normalizeResponsesRequest(body: Record<string, any>): NormalizedTraceRequest {
  const messages: TraceMessage[] = [];
  const system = asString(body.instructions) || asString(body.system);
  if (system) messages.push(message("system", system));

  let pendingToolCalls: TraceToolCall[] = [];
  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    messages.push(message("assistant", "", { toolCalls: pendingToolCalls }));
    pendingToolCalls = [];
  };

  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call" || item.type === "tool_call") {
      pendingToolCalls.push({
        id: asString(item.call_id) || asString(item.id),
        name: asString(item.name),
        arguments: stringify(item.arguments ?? {}),
      });
      continue;
    }
    flushToolCalls();
    if (item.type === "function_call_output") {
      messages.push(message("tool", stringify(item.output), { toolCallId: asString(item.call_id) }));
      continue;
    }
    if (item.type === "tool_result") {
      const result = textAndMedia(item.content);
      messages.push(message("tool", appendMediaMarker(result.text, result.mediaCount), {
        toolCallId: asString(item.tool_call_id),
        mediaCount: result.mediaCount,
      }));
      continue;
    }
    if (item.type === "message") {
      const role: TraceMessageRole = item.role === "assistant" ? "assistant" : "user";
      const result = textAndMedia(item.content);
      messages.push(message(role, appendMediaMarker(result.text, result.mediaCount), {
        mediaCount: result.mediaCount,
      }));
    }
  }
  flushToolCalls();

  return {
    format: "responses",
    messages,
    tools: normalizeResponsesTools(body),
  };
}

function normalizeChatRequest(body: Record<string, any>): NormalizedTraceRequest {
  const messages: TraceMessage[] = [];
  for (const item of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(item)) continue;
    const rawRole = asString(item.role);
    const role: TraceMessageRole = rawRole === "system" || rawRole === "assistant" || rawRole === "tool"
      ? rawRole
      : "user";
    const result = textAndMedia(item.content);
    const toolCalls = Array.isArray(item.tool_calls)
      ? item.tool_calls.filter(isRecord).map((call) => {
          const fn = isRecord(call.function) ? call.function : {};
          return {
            id: asString(call.id) || asString(call.call_id),
            name: asString(fn.name),
            arguments: stringify(fn.arguments ?? {}),
          };
        })
      : [];
    messages.push(message(role, appendMediaMarker(result.text, result.mediaCount), {
      toolCalls,
      toolCallId: asString(item.tool_call_id),
      mediaCount: result.mediaCount,
    }));
  }

  const tools: TraceToolDefinition[] = [];
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    if (!isRecord(tool) || !isRecord(tool.function)) continue;
    tools.push({
      name: asString(tool.function.name),
      description: asString(tool.function.description),
      ...(tool.function.parameters !== undefined ? { parameters: tool.function.parameters } : {}),
    });
  }
  return { format: "chat", messages, tools };
}

function geminiParts(parts: unknown): { text: string; mediaCount: number } {
  if (!Array.isArray(parts)) return { text: "", mediaCount: 0 };
  return {
    text: parts.filter(isRecord).map((part) => asString(part.text)).join(""),
    mediaCount: parts.filter((part) => isRecord(part) && isRecord(part.inlineData)).length,
  };
}

function normalizeGeminiRequest(body: Record<string, any>): NormalizedTraceRequest {
  const messages: TraceMessage[] = [];
  const systemParts = isRecord(body.systemInstruction) ? body.systemInstruction.parts : [];
  const system = geminiParts(systemParts).text;
  if (system) messages.push(message("system", system));

  let toolCallSequence = 0;
  const pendingToolCallIds: string[] = [];
  for (const content of Array.isArray(body.contents) ? body.contents : []) {
    if (!isRecord(content)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    if (content.role === "model") {
      const result = geminiParts(parts);
      const toolCalls: TraceToolCall[] = [];
      for (const part of parts) {
        if (!isRecord(part) || !isRecord(part.functionCall)) continue;
        const id = `gemini_call_${toolCallSequence++}`;
        pendingToolCallIds.push(id);
        toolCalls.push({
          id,
          name: asString(part.functionCall.name),
          arguments: stringify(part.functionCall.args ?? {}),
        });
      }
      messages.push(message("assistant", appendMediaMarker(result.text, result.mediaCount), {
        toolCalls,
        mediaCount: result.mediaCount,
      }));
      continue;
    }

    const userParts: unknown[] = [];
    for (const part of parts) {
      if (!isRecord(part) || !isRecord(part.functionResponse)) {
        userParts.push(part);
        continue;
      }
      const response = part.functionResponse.response;
      messages.push(message("tool", stringify(response), {
        toolCallId: pendingToolCallIds.shift() ?? "",
      }));
    }
    const result = geminiParts(userParts);
    const contentText = appendMediaMarker(result.text, result.mediaCount);
    if (contentText) messages.push(message("user", contentText, { mediaCount: result.mediaCount }));
  }

  const tools: TraceToolDefinition[] = [];
  for (const toolGroup of Array.isArray(body.tools) ? body.tools : []) {
    if (!isRecord(toolGroup) || !Array.isArray(toolGroup.functionDeclarations)) continue;
    for (const tool of toolGroup.functionDeclarations) {
      if (!isRecord(tool)) continue;
      tools.push({
        name: asString(tool.name),
        description: asString(tool.description),
        ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
      });
    }
  }
  return { format: "gemini", messages, tools };
}

function normalizeBedrockTools(body: Record<string, any>): TraceToolDefinition[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools
    .filter(isRecord)
    .map((tool) => ({
      name: asString(tool.name),
      description: asString(tool.description),
      ...(tool.input_schema !== undefined ? { parameters: tool.input_schema } : {}),
    }));
}

function normalizeBedrockRequest(body: Record<string, any>): NormalizedTraceRequest {
  const messages: TraceMessage[] = [];
  const system = asString(body.system);
  if (system) messages.push(message("system", system));

  for (const rawMessage of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(rawMessage)) continue;
    const role = rawMessage.role === "assistant" ? "assistant" : "user";
    const blocks = Array.isArray(rawMessage.content) ? rawMessage.content : [];

    if (role === "assistant") {
      const text: string[] = [];
      const toolCalls: TraceToolCall[] = [];
      let mediaCount = 0;
      for (const block of blocks) {
        if (!isRecord(block)) continue;
        if (block.type === "text") text.push(asString(block.text));
        if (block.type === "image") mediaCount += 1;
        if (block.type === "tool_use") {
          toolCalls.push({
            id: asString(block.id),
            name: asString(block.name),
            arguments: stringify(block.input ?? {}),
          });
        }
      }
      const content = appendMediaMarker(text.join(""), mediaCount);
      if (content || toolCalls.length > 0) {
        messages.push(message("assistant", content, { toolCalls, mediaCount }));
      }
      continue;
    }

    let text = "";
    let mediaCount = 0;
    const flushUser = () => {
      const content = appendMediaMarker(text, mediaCount);
      if (content) messages.push(message("user", content, { mediaCount }));
      text = "";
      mediaCount = 0;
    };

    for (const block of blocks) {
      if (!isRecord(block)) continue;
      if (block.type === "tool_result") {
        flushUser();
        messages.push(message("tool", stringify(block.content), {
          toolCallId: asString(block.tool_use_id),
        }));
        continue;
      }
      if (block.type === "text") text += asString(block.text);
      if (block.type === "image") mediaCount += 1;
    }
    flushUser();
  }

  return {
    format: "bedrock",
    messages,
    tools: normalizeBedrockTools(body),
  };
}

export function normalizeTraceRequest(payload: unknown): NormalizedTraceRequest {
  const payloadRecord = isRecord(payload) ? payload : {};
  const body = isRecord(payloadRecord.body) ? payloadRecord.body : {};
  if (Array.isArray(body.messages) && body.anthropic_version) {
    return normalizeBedrockRequest(body);
  }
  if (Array.isArray(body.input)) return normalizeResponsesRequest(body);
  if (Array.isArray(body.contents)) return normalizeGeminiRequest(body);
  if (Array.isArray(body.messages)) return normalizeChatRequest(body);
  return {
    format: "unknown",
    messages: [],
    tools: [],
    warning: "Unsupported trace request wire format",
  };
}

function normalizeOutputItems(items: unknown): NormalizedTraceResponse {
  const content: string[] = [];
  const toolCalls: TraceToolCall[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    if (item.type === "message") {
      const result = textAndMedia(item.content);
      content.push(appendMediaMarker(result.text, result.mediaCount));
      continue;
    }
    if (item.type === "function_call" || item.type === "tool_call") {
      toolCalls.push({
        id: asString(item.call_id) || asString(item.id),
        name: asString(item.name),
        arguments: stringify(item.arguments ?? {}),
      });
    }
  }
  return { content: content.join(""), toolCalls };
}

function normalizeResponseObject(body: Record<string, any>): NormalizedTraceResponse {
  if (Array.isArray(body.output)) {
    const result = normalizeOutputItems(body.output);
    if (!result.content && typeof body.output_text === "string") result.content = body.output_text;
    return result;
  }

  if (Array.isArray(body.choices) && isRecord(body.choices[0])) {
    const first = body.choices[0];
    const rawMessage = isRecord(first.message) ? first.message : {};
    const toolCalls = Array.isArray(rawMessage.tool_calls)
      ? rawMessage.tool_calls.filter(isRecord).map((call) => {
          const fn = isRecord(call.function) ? call.function : {};
          return {
            id: asString(call.id) || asString(call.call_id),
            name: asString(fn.name),
            arguments: stringify(fn.arguments ?? {}),
          };
        })
      : [];
    return { content: asString(rawMessage.content), toolCalls };
  }

  if (Array.isArray(body.candidates) && isRecord(body.candidates[0])) {
    const candidateContent = isRecord(body.candidates[0].content) ? body.candidates[0].content : {};
    const parts = Array.isArray(candidateContent.parts) ? candidateContent.parts : [];
    const content = geminiParts(parts).text;
    const toolCalls: TraceToolCall[] = [];
    for (const part of parts) {
      if (!isRecord(part) || !isRecord(part.functionCall)) continue;
      toolCalls.push({
        id: `gemini_response_call_${toolCalls.length}`,
        name: asString(part.functionCall.name),
        arguments: stringify(part.functionCall.args ?? {}),
      });
    }
    return { content, toolCalls };
  }

  if (Array.isArray(body.content)) {
    const content: string[] = [];
    const toolCalls: TraceToolCall[] = [];
    for (const block of body.content) {
      if (!isRecord(block)) continue;
      if (block.type === "text") content.push(asString(block.text));
      if (block.type === "tool_use") {
        toolCalls.push({
          id: asString(block.id),
          name: asString(block.name),
          arguments: stringify(block.input ?? {}),
        });
      }
    }
    return { content: content.join(""), toolCalls };
  }

  return { content: asString(body.output_text), toolCalls: [] };
}

function hasResponse(result: NormalizedTraceResponse): boolean {
  return Boolean(result.content || result.toolCalls.length > 0);
}

function normalizeStreamResponse(chunks: unknown[]): NormalizedTraceResponse {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (!isRecord(chunk) || !isRecord(chunk.response)) continue;
    const completed = normalizeResponseObject(chunk.response);
    if (hasResponse(completed)) return completed;
  }

  let responseText = "";
  let completedText = "";
  const responseToolCalls: TraceToolCall[] = [];
  const chatToolCalls = new Map<number, TraceToolCall>();

  for (const chunk of chunks) {
    if (!isRecord(chunk)) continue;
    if (chunk.type === "response.output_text.delta") responseText += asString(chunk.delta);
    if (chunk.type === "response.output_text.done") completedText = asString(chunk.text);
    if ((chunk.type === "response.output_item.done" || chunk.type === "response.output_item.added") && isRecord(chunk.item)) {
      const itemResult = normalizeOutputItems([chunk.item]);
      for (const call of itemResult.toolCalls) {
        const existing = responseToolCalls.findIndex((candidate) => candidate.id && candidate.id === call.id);
        if (existing >= 0) responseToolCalls[existing] = call;
        else responseToolCalls.push(call);
      }
    }

    const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : {};
    const delta = isRecord(choice.delta) ? choice.delta : {};
    responseText += asString(delta.content);
    for (const rawCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      if (!isRecord(rawCall)) continue;
      const index = typeof rawCall.index === "number" ? rawCall.index : chatToolCalls.size;
      const current = chatToolCalls.get(index) ?? { id: "", name: "", arguments: "" };
      const fn = isRecord(rawCall.function) ? rawCall.function : {};
      current.id += asString(rawCall.id);
      current.name += asString(fn.name);
      current.arguments += asString(fn.arguments);
      chatToolCalls.set(index, current);
    }
  }

  return {
    content: completedText || responseText,
    toolCalls: chatToolCalls.size > 0
      ? [...chatToolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
      : responseToolCalls,
  };
}

export function normalizeTraceResponse(body: unknown): NormalizedTraceResponse {
  if (Array.isArray(body)) return normalizeStreamResponse(body);
  return normalizeResponseObject(isRecord(body) ? body : {});
}

export function buildRunTranscript(events: unknown[]): RunTranscript {
  const traceEvents = events.filter(isRecord);
  let requestIndex = -1;
  for (let index = traceEvents.length - 1; index >= 0; index -= 1) {
    if (traceEvents[index].type === "llm.request") {
      requestIndex = index;
      break;
    }
  }

  if (requestIndex < 0) {
    return {
      format: "unknown",
      messages: [],
      tools: [],
      warning: "Run has no trace request",
      pendingResponse: false,
    };
  }

  const requestEvent = traceEvents[requestIndex];
  const request = normalizeTraceRequest(requestEvent.payload);
  const messages = request.messages.map((item) => ({
    ...item,
    toolCalls: item.toolCalls.map((call) => ({ ...call })),
  }));
  let response: NormalizedTraceResponse | null = null;
  let resultText = "";
  for (const event of traceEvents.slice(requestIndex + 1)) {
    if (event.type === "llm.response" && isRecord(event.payload)) {
      const candidate = normalizeTraceResponse(event.payload.body);
      if (hasResponse(candidate)) response = candidate;
    }
    if (event.type === "run.finished" && isRecord(event.payload)) {
      resultText = asString(event.payload.resultText);
    }
  }

  if (response) {
    messages.push(message("assistant", response.content, { toolCalls: response.toolCalls }));
  } else if (resultText) {
    messages.push(message("assistant", resultText));
  }

  return {
    ...request,
    messages,
    pendingResponse: !response && !resultText,
  };
}
