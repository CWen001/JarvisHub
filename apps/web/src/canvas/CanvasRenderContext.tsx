import React from 'react'

export type CanvasRenderContextValue = {
  heavySelectionActive: boolean
  heavySelectionDragging: boolean
  selectedNodeCount: number
}

export type OrthEdgeObstacle = {
  h: number
  id: string
  w: number
  x: number
  y: number
}

const DEFAULT_CANVAS_RENDER_CONTEXT: CanvasRenderContextValue = {
  heavySelectionActive: false,
  heavySelectionDragging: false,
  selectedNodeCount: 0,
}

const DEFAULT_ORTH_EDGE_OBSTACLES: readonly OrthEdgeObstacle[] = Object.freeze([])

export const CanvasRenderContext = React.createContext<CanvasRenderContextValue>(
  DEFAULT_CANVAS_RENDER_CONTEXT,
)

export const OrthEdgeObstaclesContext = React.createContext<readonly OrthEdgeObstacle[]>(
  DEFAULT_ORTH_EDGE_OBSTACLES,
)

export function useCanvasRenderContext(): CanvasRenderContextValue {
  return React.useContext(CanvasRenderContext)
}

export function useOrthEdgeObstacles(): readonly OrthEdgeObstacle[] {
  return React.useContext(OrthEdgeObstaclesContext)
}
