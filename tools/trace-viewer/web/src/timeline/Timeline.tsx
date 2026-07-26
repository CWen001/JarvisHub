import React from "react";
import { Stack, Box, Badge, Text, Code, Paper, Group } from "@mantine/core";
import type { TraceRunView, TraceTreeView } from "../../../shared/runView";
import type { TraceMessage, TraceToolDefinition } from "./traceMessages";

interface Props {
  view: TraceTreeView;
  search: string;
}

const ROLE_COLORS: Record<string, string> = { system: "gray", user: "blue", assistant: "green", tool: "yellow" };

function highlightText(text: string, search: string): React.ReactNode {
  if (!search || !text) return text;
  const index = text.toLowerCase().indexOf(search.toLowerCase());
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + search.length)}</mark>{text.slice(index + search.length)}</>;
}

function includesSearch(value: unknown, search: string): boolean {
  return !search || JSON.stringify(value).toLowerCase().includes(search.toLowerCase());
}

function MessageRow({ message, search }: { message: TraceMessage; search: string }) {
  const color = ROLE_COLORS[message.role] ?? "gray";
  return <Paper shadow="xs" p="xs" withBorder style={{ borderLeft: `3px solid var(--mantine-color-${color}-5)` }}>
    <Badge size="xs" color={color} variant="light" mb={4}>{message.role}{message.toolCalls.length ? ` (${message.toolCalls.length} tool_calls)` : ""}</Badge>
    {message.content && <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>{highlightText(message.content, search)}</Text>}
    {message.toolCalls.map((call) => <Box key={call.id || `${call.name}:${call.arguments}`} mt={4} p="xs" style={{ background: "var(--mantine-color-gray-0)", borderRadius: 4 }}>
      <Text size="xs" ff="monospace" fw={500} c="violet">{highlightText(call.name, search)}</Text>
      <Text size="xs" ff="monospace" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>{highlightText(call.arguments, search)}</Text>
    </Box>)}
    {message.toolCallId && <Text size="xs" c="dimmed" ff="monospace">tool_call_id: {message.toolCallId}</Text>}
  </Paper>;
}

function ToolSchemas({ tools, search }: { tools: TraceToolDefinition[]; search: string }) {
  const visible = tools.filter((tool) => includesSearch(tool, search));
  if (!visible.length) return null;
  return <Paper shadow="xs" p="xs" withBorder style={{ borderLeft: "3px solid var(--mantine-color-violet-5)" }}>
    <Badge size="xs" color="violet" variant="light" mb={4}>tools ({visible.length})</Badge>
    <Stack gap={4}>{visible.map((tool) => <Box key={tool.name} p="xs" style={{ background: "var(--mantine-color-gray-0)", borderRadius: 4 }}>
      <Text size="xs" ff="monospace" fw={500} c="violet">{highlightText(tool.name, search)}</Text>
      {tool.description && <Text size="xs" c="dimmed">{highlightText(tool.description, search)}</Text>}
      {tool.parameters !== undefined && <Code block style={{ fontSize: 10, maxHeight: 200, overflow: "auto" }}>{JSON.stringify(tool.parameters, null, 2)}</Code>}
    </Box>)}</Stack>
  </Paper>;
}

function RunBlock({ run, search }: { run: TraceRunView; search: string }) {
  const transcript = run.transcript;
  const color = run.depth === 0 ? "blue" : "violet";
  return <Stack gap="xs" style={{ paddingLeft: run.depth * 12, borderLeft: run.depth ? `2px dashed var(--mantine-color-${color}-5)` : undefined }}>
    <Paper shadow="xs" p="xs" withBorder><Group gap="xs">
      <Badge color={color} variant="filled" size="xs">{run.depth === 0 ? "RUN" : `SUBAGENT · ${run.subagentName ?? "?"}`}</Badge>
      {run.startedAt && <Text size="xs" c="dimmed">{new Date(run.startedAt).toLocaleTimeString()}</Text>}
      <Text size="xs" fw={500}>{transcript.messages.length} messages</Text>
      <Text size="xs" c="dimmed">depth {run.depth}</Text>
      <Text size="xs" c="dimmed" ff="monospace">{run.runId.slice(0, 8)}</Text>
      <Badge size="xs" color={run.status === "errored" ? "red" : run.status === "finished" ? "green" : "yellow"} variant="light">{run.status}</Badge>
    </Group></Paper>
    {transcript.warning && <Text size="xs" c="orange">{transcript.warning}</Text>}
    {transcript.messages.filter((message) => includesSearch(message, search)).map((message, index) => <MessageRow key={index} message={message} search={search} />)}
    {run.children.map((child) => <RunBlock key={child.runId} run={child} search={search} />)}
    <ToolSchemas tools={transcript.tools} search={search} />
  </Stack>;
}

export function Timeline({ view, search }: Props) {
  if (!view.roots.length) return <Text c="dimmed" ta="center" mt="xl">No runs in this trace</Text>;
  return <Stack className="trace-timeline" gap="xs">{view.roots.map((run) => <RunBlock key={run.runId} run={run} search={search} />)}</Stack>;
}
