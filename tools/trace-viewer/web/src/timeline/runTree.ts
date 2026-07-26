export interface TraceEventLike {
  ts: string;
  runId: string;
  parentRunId?: string;
  depth: number;
  seq: number;
  type: string;
  payload?: any;
}

export interface RunNode {
  runId: string;
  parentRunId?: string;
  depth: number;
  subagentName?: string;
  events: TraceEventLike[];
  children: RunNode[];
  agentChildrenByToolCallId: Map<string, RunNode>;
}

export function groupEventsByRun(events: TraceEventLike[]): Map<string, TraceEventLike[]> {
  const out = new Map<string, TraceEventLike[]>();
  for (const ev of events) {
    if (!ev.runId) continue;
    const bucket = out.get(ev.runId);
    if (bucket) bucket.push(ev);
    else out.set(ev.runId, [ev]);
  }
  return out;
}

export function buildRunTree(events: TraceEventLike[]): RunNode[] {
  const grouped = groupEventsByRun(events);
  const nodes = new Map<string, RunNode>();
  for (const [runId, runEvents] of grouped) {
    const first = runEvents[0];
    nodes.set(runId, {
      runId,
      parentRunId: first?.parentRunId,
      depth: first?.depth ?? 0,
      events: runEvents,
      children: [],
      agentChildrenByToolCallId: new Map(),
    });
  }

  const ordered = [...events].sort((a, b) =>
    (a.ts || "").localeCompare(b.ts || "") || (a.seq ?? 0) - (b.seq ?? 0),
  );
  const pendingDispatches = new Map<string, { toolCallId: string; subagentName: string }[]>();
  for (const ev of ordered) {
    if (ev.type === "subagent.dispatch") {
      const queue = pendingDispatches.get(ev.runId) ?? [];
      queue.push({
        toolCallId: ev.payload?.toolCallId ?? "",
        subagentName: ev.payload?.subagentName ?? "",
      });
      pendingDispatches.set(ev.runId, queue);
      continue;
    }
    if (ev.type === "run.started" && ev.parentRunId) {
      const queue = pendingDispatches.get(ev.parentRunId);
      const runtimeMeta = ev.payload?.runtimeMeta;
      const parentToolCallId = typeof runtimeMeta?.parentToolCallId === "string"
        ? runtimeMeta.parentToolCallId
        : "";
      const exactDispatchIndex = parentToolCallId
        ? queue?.findIndex((item) => item.toolCallId === parentToolCallId) ?? -1
        : -1;
      const dispatch = exactDispatchIndex >= 0
        ? queue?.splice(exactDispatchIndex, 1)[0]
        : parentToolCallId
          ? undefined
          : queue?.shift();
      const childNode = nodes.get(ev.runId);
      const parentNode = nodes.get(ev.parentRunId);
      const runtimeAgentType = typeof runtimeMeta?.currentAgentType === "string"
        ? runtimeMeta.currentAgentType
        : "";
      if (childNode && (runtimeAgentType || dispatch?.subagentName)) {
        childNode.subagentName = runtimeAgentType || dispatch?.subagentName;
      }
      const toolCallId = parentToolCallId || dispatch?.toolCallId || "";
      if (parentNode && childNode && toolCallId) {
        parentNode.agentChildrenByToolCallId.set(toolCallId, childNode);
      }
    }
  }

  const roots: RunNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentRunId ? nodes.get(node.parentRunId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function mergeRunTreeEvents(
  current: TraceEventLike[],
  incoming: TraceEventLike[],
  rootRunId: string,
): TraceEventLike[] {
  const byEventId = new Map<string, TraceEventLike>();
  for (const event of [...current, ...incoming]) {
    if (!event?.runId || typeof event.seq !== "number") continue;
    byEventId.set(`${event.runId}:${event.seq}`, event);
  }

  const parentByRunId = new Map<string, string>();
  for (const event of byEventId.values()) {
    if (event.parentRunId) parentByRunId.set(event.runId, event.parentRunId);
  }

  const belongsToRoot = (runId: string): boolean => {
    const visited = new Set<string>();
    let currentRunId = runId;
    while (currentRunId && !visited.has(currentRunId)) {
      if (currentRunId === rootRunId) return true;
      visited.add(currentRunId);
      currentRunId = parentByRunId.get(currentRunId) ?? "";
    }
    return false;
  };

  return [...byEventId.values()]
    .filter((event) => belongsToRoot(event.runId))
    .sort((a, b) =>
      (a.ts || "").localeCompare(b.ts || "") ||
      (a.seq ?? 0) - (b.seq ?? 0),
    );
}
