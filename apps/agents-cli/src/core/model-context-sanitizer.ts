import type { Message } from "../types/index.js";

const INTERNAL_MEDIA_URL_PATTERN = /(?:https?:\/\/[^\s<>{}\[\]"']+)?\/(?:assets\/r2\/)?gen\/(?:images|videos|thumbnails)\/[\w./?&=%+~-]+/gi;
const INTERNAL_MEDIA_URL_REPLACEMENT = "[internal canvas media URL omitted; use sourceNodeId]";

export function sanitizeInternalMediaUrlText(value: string): string {
  return value.replace(INTERNAL_MEDIA_URL_PATTERN, INTERNAL_MEDIA_URL_REPLACEMENT);
}

function sanitizeToolArguments(value: string): string {
  return sanitizeInternalMediaUrlText(value);
}

export function sanitizeModelContext(input: {
  system: string;
  messages: Message[];
}): { system: string; messages: Message[] } {
  return {
    system: sanitizeInternalMediaUrlText(input.system),
    messages: input.messages.map((message) => ({
      ...message,
      content: sanitizeInternalMediaUrlText(message.content),
      toolCalls: message.toolCalls?.map((call) => ({
        ...call,
        arguments: sanitizeToolArguments(call.arguments),
      })),
      contentParts: message.contentParts?.map((part) => ({ ...part })),
    } as Message)),
  };
}
