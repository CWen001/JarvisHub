/**
 * Load complete user/agent conversation for a flow.
 *
 * Session keys follow `project:{pid}:flow:{fid}:lane:{lane}` (see
 * `apps/web/src/ui/chat/chatSessionKey.ts`). We list all sessions matching
 * `project:{pid}:flow:{fid}` prefix, then dump up to 80 messages per session
 * (existing repo cap — for v0 we accept this; absurdly long flows show a
 * "trailing 80 only" notice in the HTML metadata).
 */

import type { PrismaClient } from "../../types";
import {
  listPublicChatMessages,
  listPublicChatSessionsByPrefix,
  type PublicChatMessageRow,
  type PublicChatSessionRow,
} from "../apiKey/public-chat-session.repo";

export type FlowConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  assetsJson: string | null;
  askUserPromptJson: string | null;
  uiSnapshotJson: string | null;
};

export type FlowConversationSession = {
  sessionId: string;
  sessionKey: string;
  updatedAt: string;
  messages: FlowConversationMessage[];
  truncated: boolean;
};

export type FlowConversation = {
  sessions: FlowConversationSession[];
  totalMessages: number;
  truncatedSessionCount: number;
};

const SESSION_LIMIT = 30;
const MESSAGES_PER_SESSION = 80;

function rowToMessage(row: PublicChatMessageRow): FlowConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    assetsJson: row.assets_json,
    askUserPromptJson: row.ask_user_prompt_json,
    uiSnapshotJson: row.ui_snapshot_json,
  };
}

export async function loadFlowConversation(
  db: PrismaClient,
  input: { userId: string; projectId: string; flowId: string },
): Promise<FlowConversation> {
  const prefix = `project:${input.projectId}:flow:${input.flowId}`;
  const sessions: PublicChatSessionRow[] = await listPublicChatSessionsByPrefix(db, {
    userId: input.userId,
    sessionKeyPrefix: prefix,
    limit: SESSION_LIMIT,
  });

  const out: FlowConversationSession[] = [];
  let totalMessages = 0;
  let truncatedSessionCount = 0;

  for (const s of sessions) {
    const rows = await listPublicChatMessages(db, {
      userId: input.userId,
      sessionId: s.id,
      limit: MESSAGES_PER_SESSION,
    });
    const messages = rows.map(rowToMessage);
    const truncated = rows.length >= MESSAGES_PER_SESSION;
    if (truncated) truncatedSessionCount += 1;
    totalMessages += messages.length;
    out.push({
      sessionId: s.id,
      sessionKey: s.session_key,
      updatedAt: s.updated_at,
      messages,
      truncated,
    });
  }

  out.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));

  return {
    sessions: out,
    totalMessages,
    truncatedSessionCount,
  };
}
