import { describe, expect, it } from "vitest";

import { assertImageCanvasOutputTargetCompatible } from "./agents-tool-bridge.generate-image-to-canvas";

function taskNode(id: string, kind: string) {
  return { id, type: "taskNode", data: { kind } };
}

describe("assertImageCanvasOutputTargetCompatible", () => {
  it("rejects changing an existing image node into an imageEdit before generation", () => {
    expect(() => assertImageCanvasOutputTargetCompatible({
      nodes: [taskNode("watch_concept_hero_01", "image")],
      nodeId: "watch_concept_hero_01",
      incomingKind: "imageEdit",
    })).toThrowError(expect.objectContaining({
      code: "agents_tool_node_id_kind_mismatch",
      status: 409,
    }))
  })

  it("accepts replacing an existing node when its kind is unchanged", () => {
    expect(() => assertImageCanvasOutputTargetCompatible({
      nodes: [taskNode("watch_concept_hero_01", "image")],
      nodeId: "watch_concept_hero_01",
      incomingKind: "image",
    })).not.toThrow()
  })

  it("accepts a new stable output key", () => {
    expect(() => assertImageCanvasOutputTargetCompatible({
      nodes: [taskNode("watch_concept_hero_01", "image")],
      nodeId: "watch_concept_crystal_sport_01",
      incomingKind: "imageEdit",
    })).not.toThrow()
  })
})
