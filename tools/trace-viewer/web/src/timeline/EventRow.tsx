import React, { useState } from "react";
import { Paper, Group, Text, Badge, Code, ActionIcon, Box, Stack } from "@mantine/core";

interface Props {
  event: any;
  showRaw: boolean;
  search: string;
  prevMessageCount?: number;
}

const TYPE_COLORS: Record<string, string> = {
  "run.started": "blue",
  "run.finished": "green",
  "run.errored": "red",
  "llm.request": "violet",
  "llm.response": "grape",
  "llm.stream.delta": "gray",
  "tool.start": "orange",
  "tool.end": "yellow",
  "subagent.dispatch": "cyan",
  "skill.load": "teal",
};

function highlightText(text: string, search: string): React.ReactNode {
  if (!search || !text) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

function truncate(text: string, max = 500): string {
  if (!text || text.length <= max) return text ?? "";
  return text.slice(0, max) + "…";
}

function extractMessages(body: any): any[] {
  if (!body) return [];
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.messages)) return body.messages;
  return [];
}

function extractThinking(text: string): { thinking: string; rest: string } {
  const pattern = /<think_never_used_[^>]*>([\s\S]*?)<\/think_never_used_[^>]*>/;
  const match = text.match(pattern);
  if (match) {
    const thinking = match[1].trim();
    const rest = text.replace(match[0], "").trim();
    return { thinking, rest };
  }
  return { thinking: "", rest: text };
}

function extractResponseContent(body: any): { content: string; toolCalls: any[] } {
  if (!body) return { content: "", toolCalls: [] };
  if (Array.isArray(body.choices) && body.choices[0]?.message) {
    const msg = body.choices[0].message;
    return {
      content: msg.content ?? "",
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    };
  }
  if (Array.isArray(body.output)) {
    let content = "";
    const toolCalls: any[] = [];
    for (const item of body.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text") content += c.text ?? "";
        }
      }
      if (item.type === "function_call") {
        toolCalls.push({ function: { name: item.name, arguments: item.arguments } });
      }
    }
    return { content, toolCalls };
  }
  return { content: "", toolCalls: [] };
}

function formatToolCallSummary(tc: any): string {
  const name = tc.function?.name ?? tc.name ?? "?";
  let argsStr = "";
  try {
    const args = typeof tc.function?.arguments === "string"
      ? JSON.parse(tc.function.arguments)
      : tc.function?.arguments ?? {};
    const keys = Object.keys(args);
    if (keys.length <= 3) {
      argsStr = keys.map(k => {
        const v = args[k];
        const vs = typeof v === "string" ? (v.length > 30 ? v.slice(0, 30) + "…" : v) : JSON.stringify(v);
        return `${k}=${vs}`;
      }).join(", ");
    } else {
      argsStr = keys.slice(0, 3).map(k => k).join(", ") + `… (${keys.length} args)`;
    }
  } catch { /* ignore */ }
  return `→ ${name}(${argsStr})`;
}

// Fix 1: Resolve role for Responses API items (function_call / function_call_output)
function resolveRole(msg: any): { role: string; label: string } {
  if (msg.role) return { role: msg.role, label: msg.role };
  if (msg.type === "function_call") return { role: "assistant", label: `tool_call: ${msg.name ?? "?"}` };
  if (msg.type === "function_call_output") return { role: "tool", label: "tool_result" };
  return { role: "unknown", label: "unknown" };
}

// Fix 3: Extract display content from various message formats
function extractMessageContent(msg: any): string {
  if (msg.type === "function_call") {
    const args = typeof msg.arguments === "string" ? msg.arguments : JSON.stringify(msg.arguments ?? {});
    return truncate(args, 500);
  }
  if (msg.type === "function_call_output") {
    return truncate(msg.output ?? "", 500);
  }
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  return "";
}

const ROLE_COLORS: Record<string, string> = { system: "gray", user: "blue", assistant: "green", tool: "yellow" };

function convertToTrainingMessages(body: any): any[] {
  const messages: any[] = [];
  if (body?.instructions) {
    messages.push({ role: "system", content: body.instructions });
  }
  const input = Array.isArray(body?.input) ? body.input : [];
  let pendingToolCalls: any[] = [];

  for (const item of input) {
    if (item.type === "message") {
      if (pendingToolCalls.length > 0) {
        messages.push({ role: "assistant", tool_calls: pendingToolCalls });
        pendingToolCalls = [];
      }
      const role = item.role || "user";
      let content = "";
      if (typeof item.content === "string") {
        content = item.content;
      } else if (Array.isArray(item.content)) {
        content = item.content.map((c: any) => c.text ?? c.content ?? "").filter(Boolean).join("");
      }
      messages.push({ role, content });
    } else if (item.type === "function_call") {
      pendingToolCalls.push({
        id: item.call_id ?? item.id ?? "",
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "" },
      });
    } else if (item.type === "function_call_output") {
      if (pendingToolCalls.length > 0) {
        messages.push({ role: "assistant", tool_calls: pendingToolCalls });
        pendingToolCalls = [];
      }
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
    }
  }
  if (pendingToolCalls.length > 0) {
    messages.push({ role: "assistant", tool_calls: pendingToolCalls });
  }
  return messages;
}

function TrainingDataView({ body, search }: { body: any; search: string }) {
  const messages = convertToTrainingMessages(body);
  return (
    <Box className="trace-training-data" mt={4}>
      <Stack gap={2}>
        {messages.map((msg: any, i: number) => {
          const role = msg.role;
          const color = ROLE_COLORS[role] ?? "gray";
          const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
          return (
            <Box key={i} pl="xs" style={{ borderLeft: `2px solid var(--mantine-color-${color}-5)` }} mb={4}>
              <Badge size="xs" color={color} variant="light" mb={2}>
                {role}{hasToolCalls ? ` (${msg.tool_calls.length} tool_calls)` : ""}
              </Badge>
              {msg.content && (
                <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                  {highlightText(msg.content, search)}
                </Text>
              )}
              {hasToolCalls && msg.tool_calls.map((tc: any, j: number) => (
                <Box key={j} mt={2} p="xs" style={{ background: "var(--mantine-color-gray-0)", borderRadius: 4 }}>
                  <Text size="xs" ff="monospace" fw={500} c="violet">{tc.function?.name}</Text>
                  <Text size="xs" ff="monospace" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>{tc.function?.arguments ?? ""}</Text>
                </Box>
              ))}
              {msg.tool_call_id && (
                <Text size="xs" c="dimmed" ff="monospace">tool_call_id: {msg.tool_call_id}</Text>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function MessageBlock({ msg, search, expanded }: { msg: any; search: string; expanded: boolean }) {
  const { role, label } = resolveRole(msg);
  const content = extractMessageContent(msg);

  return (
    <Box className="trace-message-block" pl="xs" style={{ borderLeft: `2px solid var(--mantine-color-${ROLE_COLORS[role] ?? "gray"}-5)` }} mb={4}>
      <Badge className="trace-message-role" size="xs" color={ROLE_COLORS[role] ?? "gray"} variant="light" mb={2}>
        {label}
      </Badge>
      {content && (
        <Text className="trace-message-content" size="xs" style={{ whiteSpace: "pre-wrap" }} lineClamp={expanded ? undefined : 4}>
          {highlightText(expanded ? content : truncate(content, 500), search)}
        </Text>
      )}
    </Box>
  );
}

function ToolCallDetail({ tc, search }: { tc: any; search: string }) {
  const name = tc.function?.name ?? tc.name ?? "?";
  const id = tc.id ?? "";
  let args: any = {};
  try {
    args = typeof tc.function?.arguments === "string"
      ? JSON.parse(tc.function.arguments)
      : tc.function?.arguments ?? {};
  } catch { /* ignore */ }

  return (
    <Box className="trace-toolcall-detail" p="xs" style={{ background: "var(--mantine-color-gray-0)", borderRadius: 4 }} mb={4}>
      <Group className="trace-toolcall-header" gap="xs" mb={4}>
        <Badge className="trace-toolcall-name" size="xs" color="violet" variant="filled">{name}</Badge>
        {id && <Text className="trace-toolcall-id" size="xs" c="dimmed">{id}</Text>}
      </Group>
      <Code className="trace-toolcall-args" block style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>
        {highlightText(JSON.stringify(args, null, 2), search)}
      </Code>
    </Box>
  );
}

// Fix 4: Tool schema display component
function ToolSchemaList({ tools, search }: { tools: any[]; search: string }) {
  const [expandedTool, setExpandedTool] = useState<number | null>(null);

  return (
    <Box className="trace-tools-schema-list" mt={4}>
      <Text size="xs" fw={500} c="dimmed" mb={4}>Tools ({tools.length}):</Text>
      <Stack gap={2}>
        {tools.map((t: any, i: number) => {
          const name = t.function?.name ?? t.name ?? "?";
          const desc = t.function?.description ?? t.description ?? "";
          const params = t.function?.parameters ?? t.parameters;
          const isExpanded = expandedTool === i;
          return (
            <Box key={i} className="trace-tool-schema-item">
              <Group gap="xs" style={{ cursor: "pointer" }} onClick={() => setExpandedTool(isExpanded ? null : i)}>
                <Text size="xs" ff="monospace" fw={500} c="violet">{name}</Text>
                <Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>{truncate(desc, 80)}</Text>
                <Text size="xs" c="dimmed">{isExpanded ? "▾" : "▸"}</Text>
              </Group>
              {isExpanded && params && (
                <Code block style={{ fontSize: 11, maxHeight: 200, overflow: "auto", marginTop: 4 }}>
                  {highlightText(JSON.stringify(params, null, 2), search)}
                </Code>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

export function EventRow({ event, showRaw, search, prevMessageCount = 0 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const { type, payload, ts, depth } = event;
  const color = TYPE_COLORS[type] ?? "gray";
  const time = ts ? new Date(ts).toLocaleTimeString() : "";
  const indent = (depth ?? 0) * 16;

  const messages = (type === "llm.request") ? extractMessages(payload?.body) : [];
  const responseData = (type === "llm.response") ? extractResponseContent(payload?.body) : { content: "", toolCalls: [] };

  // Fix 2: compute new messages for this turn
  const newMessages = messages.length > prevMessageCount ? messages.slice(prevMessageCount) : messages;
  const hasHistory = prevMessageCount > 0 && messages.length > prevMessageCount;

  return (
    <Paper
      className={`trace-event-row trace-event-${type.replace(".", "-")}`}
      shadow="xs"
      p="xs"
      withBorder
      style={{ marginLeft: indent }}
    >
      <Group className="trace-event-header" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Badge className="trace-event-badge" size="xs" color={color} variant="filled">{type}</Badge>
          <Text className="trace-event-time" size="xs" c="dimmed">{time}</Text>
          {payload?.__legacy && <Badge size="xs" color="gray" variant="outline">legacy</Badge>}
          {type === "llm.request" && payload?.stream && <Badge size="xs" color="violet" variant="light">stream</Badge>}
          {type === "llm.request" && (
            <Text size="xs" c="dimmed">
              {payload?.clientKind} → {String(payload?.url ?? "").split("/").pop()}
              {messages.length > 0 && ` (${messages.length} msgs)`}
            </Text>
          )}
          {type === "llm.response" && (
            <>
              <Badge size="xs" color={payload?.status === 200 ? "green" : "red"} variant="light">
                {payload?.status}
              </Badge>
              <Text size="xs" c="dimmed">{payload?.durationMs}ms</Text>
            </>
          )}
          {type === "tool.start" && (
            <Text size="xs" fw={500}>{highlightText(payload?.name ?? "", search)}</Text>
          )}
          {type === "tool.end" && (
            <>
              <Text size="xs" fw={500}>{highlightText(payload?.name ?? "", search)}</Text>
              <Badge size="xs" color={payload?.status === "succeeded" ? "green" : "red"} variant="light">
                {payload?.status}
              </Badge>
              <Text size="xs" c="dimmed">{payload?.durationMs}ms</Text>
            </>
          )}
        </Group>
        <ActionIcon
          className="trace-event-expand"
          size="xs"
          variant="subtle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "−" : "+"}
        </ActionIcon>
      </Group>

      <Box className="trace-event-summary" mt={4}>
        {type === "run.started" && (
          <Text size="sm" lineClamp={expanded ? undefined : 3}>
            {highlightText(payload?.prompt ?? "", search)}
          </Text>
        )}
        {type === "run.finished" && (
          <Text size="sm" c="green" lineClamp={expanded ? undefined : 3}>
            {highlightText(truncate(payload?.resultText ?? "", expanded ? 10000 : 300), search)}
          </Text>
        )}
        {type === "run.errored" && (
          <Text size="sm" c="red">
            {highlightText(payload?.errorMessage ?? "", search)}
          </Text>
        )}

        {/* llm.request: collapsed preview — show latest user message + message count */}
        {type === "llm.request" && !expanded && (
          <Box className="trace-llm-request-preview">
            {(() => {
              const allMsgs = convertToTrainingMessages(payload?.body);
              const lastUserMsg = [...allMsgs].reverse().find(m => m.role === "user");
              const content = lastUserMsg?.content ?? "";
              return content ? (
                <Text className="trace-llm-request-content" size="xs" lineClamp={2} style={{ whiteSpace: "pre-wrap" }}>
                  <Text span size="xs" c="blue" fw={500}>[user] </Text>
                  {highlightText(truncate(content, 200), search)}
                </Text>
              ) : null;
            })()}
            <Text size="xs" c="dimmed" mt={2}>
              {(() => {
                const allMsgs = convertToTrainingMessages(payload?.body);
                const counts: Record<string, number> = {};
                allMsgs.forEach(m => { counts[m.role] = (counts[m.role] || 0) + 1; });
                return Object.entries(counts).map(([r, c]) => `${r}:${c}`).join(" ");
              })()}
              {payload?.body?.tools ? ` | tools:${payload.body.tools.length}` : ""}
            </Text>
          </Box>
        )}

        {/* llm.request expanded: show as training messages format */}
        {type === "llm.request" && expanded && (
          <TrainingDataView body={payload?.body} search={search} />
        )}

        {/* llm.response: show content + tool_calls with thinking extraction */}
        {type === "llm.response" && (() => {
          const { thinking, rest } = extractThinking(responseData.content);
          return (
            <Box className="trace-llm-response-content">
              {thinking && (
                <Box className="trace-thinking-block" p="xs" mt={4} style={{ background: "rgba(251, 192, 45, 0.1)", borderLeft: "3px solid #FBC02D", borderRadius: 4 }}>
                  <Text size="xs" fw={500} c="yellow" mb={2}>[THINKING]</Text>
                  <Text className="trace-thinking-text" size="xs" style={{ whiteSpace: "pre-wrap" }} lineClamp={expanded ? undefined : 4}>
                    {highlightText(expanded ? thinking : truncate(thinking, 300), search)}
                  </Text>
                </Box>
              )}
              {rest && (
                <Text className="trace-response-text" size="xs" style={{ whiteSpace: "pre-wrap" }} lineClamp={expanded ? undefined : 5} mt={4}>
                  {highlightText(expanded ? rest : truncate(rest, 500), search)}
                </Text>
              )}
              {responseData.toolCalls.length > 0 && !expanded && (
                <Stack className="trace-response-toolcalls-preview" gap={0} mt={4}>
                  {responseData.toolCalls.map((tc: any, i: number) => (
                    <Text className="trace-response-toolcall-line" key={i} size="xs" c="violet" ff="monospace">
                      {formatToolCallSummary(tc)}
                    </Text>
                  ))}
                </Stack>
              )}
              {responseData.toolCalls.length > 0 && expanded && (
                <Box className="trace-response-toolcalls-detail" mt={8}>
                  <Text size="xs" fw={500} c="dimmed" mb={4}>Tool Calls ({responseData.toolCalls.length}):</Text>
                  {responseData.toolCalls.map((tc: any, i: number) => (
                    <ToolCallDetail key={i} tc={tc} search={search} />
                  ))}
                </Box>
              )}
            </Box>
          );
        })()}

        {/* tool.start: show args preview */}
        {type === "tool.start" && !expanded && (
          <Code className="trace-tool-args-preview" block style={{ fontSize: 11, maxHeight: 60, overflow: "hidden" }} mt={2}>
            {truncate(JSON.stringify(payload?.args ?? {}, null, 2), 200)}
          </Code>
        )}
        {type === "tool.start" && expanded && (
          <Code className="trace-tool-args-full" block style={{ fontSize: 11, maxHeight: 400, overflow: "auto" }} mt={4}>
            {highlightText(JSON.stringify(payload?.args ?? {}, null, 2), search)}
          </Code>
        )}

        {/* tool.end: show output */}
        {type === "tool.end" && (
          <>
            {payload?.errorMessage && <Text size="xs" c="red" mt={2}>{payload.errorMessage}</Text>}
            {payload?.output && (
              <Text className="trace-tool-output" size="xs" style={{ whiteSpace: "pre-wrap" }} lineClamp={expanded ? undefined : 2} mt={2} c="dimmed">
                {highlightText(expanded ? payload.output : truncate(payload.output, 200), search)}
              </Text>
            )}
            {expanded && payload?.outputJson && (
              <Code className="trace-tool-output-json" block style={{ fontSize: 11, maxHeight: 300, overflow: "auto" }} mt={4}>
                {JSON.stringify(payload.outputJson, null, 2)}
              </Code>
            )}
          </>
        )}

        {type === "subagent.dispatch" && (
          <Group gap="xs">
            <Badge size="xs" color="cyan" variant="light">{payload?.subagentName}</Badge>
            <Text size="xs" c="dimmed" lineClamp={expanded ? undefined : 1}>
              {highlightText(expanded ? (payload?.childPrompt ?? "") : truncate(payload?.childPrompt ?? "", 100), search)}
            </Text>
          </Group>
        )}
        {type === "skill.load" && (
          <Group gap="xs">
            <Text size="sm">{payload?.skillName}</Text>
            <Badge size="xs" variant="light">{payload?.charsLoaded} chars</Badge>
            {payload?.deferred && <Badge size="xs" color="yellow" variant="light">deferred</Badge>}
          </Group>
        )}
        {type === "llm.stream.delta" && (
          <Text size="xs" c="dimmed" lineClamp={expanded ? undefined : 1}>
            {highlightText(expanded ? (payload?.rawLine ?? "") : truncate(payload?.rawLine ?? "", 100), search)}
          </Text>
        )}
      </Box>

      {/* Raw JSON — only when global Raw toggle is on */}
      {showRaw && (
        <Code className="trace-event-raw" block mt="xs" style={{ maxHeight: 400, overflow: "auto", fontSize: 11 }}>
          {JSON.stringify(payload, null, 2)}
        </Code>
      )}
    </Paper>
  );
}
