import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DiffStatus, EdgeKind, Graph, NodeType } from "./types";

type GraphViewProps = {
  graph: Graph;
  visibleNodeTypes: Set<NodeType>;
  visibleEdgeKinds: Set<EdgeKind>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  nodeStatusById?: Map<string, DiffStatus>;
  edgeStatusByKey?: Map<string, DiffStatus>;
};

const NODE_COLOR: Record<NodeType, string> = {
  page: "#3b82f6",
  endpoint: "#059669",
  db: "#dc2626",
  handler: "#14b8a6",
  action: "#fbbf24",
};

const NODE_BORDER: Record<NodeType, string> = {
  page: "#2563eb",
  endpoint: "#047857",
  db: "#b91c1c",
  handler: "#0d9488",
  action: "#f59e0b",
};

const EDGE_COLOR: Record<EdgeKind, string> = {
  "page-endpoint": "#06b6d4",
  "endpoint-db": "#f97316",
  "endpoint-handler": "#22c55e",
  "page-action": "#eab308",
  "action-endpoint": "#a855f7",
};

const DIFF_BORDER_COLOR: Record<DiffStatus, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  modified: "#f59e0b",
  unchanged: "rgba(15, 23, 42, 0.12)",
};

const DIFF_EDGE_COLOR: Record<DiffStatus, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  modified: "#f59e0b",
  unchanged: "#000000",
};

function buildEdgeKey(from: string, to: string, kind: EdgeKind): string {
  return `${from}::${to}::${kind}`;
}

/**
 * Reorder nodes within each column so that connected nodes are placed
 * close together vertically, minimizing long diagonal edge crossings.
 * Uses an iterative barycenter heuristic.
 */
function optimizeNodeOrder(
  nodesByType: Map<NodeType, Graph["nodes"]>,
  activeTypeOrder: NodeType[],
  edges: Graph["edges"],
  visibleNodeIds: Set<string>,
  visibleEdgeKinds: Set<EdgeKind>,
): Map<NodeType, Graph["nodes"]> {
  // Build adjacency map: nodeId -> list of connected nodeIds
  const adjacency = new Map<string, string[]>();
  for (const nodeId of visibleNodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    if (
      !visibleEdgeKinds.has(edge.kind) ||
      !visibleNodeIds.has(edge.from) ||
      !visibleNodeIds.has(edge.to)
    )
      continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  // Track each node's row index within its column
  const nodeRowIndex = new Map<string, number>();
  for (const type of activeTypeOrder) {
    const nodes = nodesByType.get(type) ?? [];
    nodes.forEach((node, i) => nodeRowIndex.set(node.id, i));
  }

  // Iterative barycenter: forward pass then reverse pass, repeated
  const ITERATIONS = 3;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Forward pass (left to right)
    for (let col = 1; col < activeTypeOrder.length; col++) {
      reorderColumn(activeTypeOrder[col], nodesByType, adjacency, nodeRowIndex);
    }
    // Reverse pass (right to left)
    for (let col = activeTypeOrder.length - 2; col >= 0; col--) {
      reorderColumn(activeTypeOrder[col], nodesByType, adjacency, nodeRowIndex);
    }
  }

  return nodesByType;
}

function reorderColumn(
  type: NodeType,
  nodesByType: Map<NodeType, Graph["nodes"]>,
  adjacency: Map<string, string[]>,
  nodeRowIndex: Map<string, number>,
): void {
  const nodes = nodesByType.get(type);
  if (!nodes || nodes.length <= 1) return;

  // Compute barycenter for each node (average row of connected nodes)
  const barycenters = new Map<string, number>();
  for (const node of nodes) {
    const neighbors = adjacency.get(node.id) ?? [];
    const neighborRows = neighbors
      .map((nid) => nodeRowIndex.get(nid))
      .filter((r): r is number => r !== undefined);
    if (neighborRows.length > 0) {
      const avg = neighborRows.reduce((s, r) => s + r, 0) / neighborRows.length;
      barycenters.set(node.id, avg);
    } else {
      // No connections: keep current position as a tiebreaker
      barycenters.set(node.id, nodeRowIndex.get(node.id) ?? 0);
    }
  }

  nodes.sort((a, b) => (barycenters.get(a.id) ?? 0) - (barycenters.get(b.id) ?? 0));

  // Update row indices after reorder
  nodes.forEach((node, i) => nodeRowIndex.set(node.id, i));
}

export function GraphView(props: GraphViewProps) {
  const {
    graph,
    visibleNodeTypes,
    visibleEdgeKinds,
    selectedNodeId,
    onSelectNode,
    nodeStatusById,
    edgeStatusByKey,
  } = props;

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const handleNodeClick: NodeMouseHandler = (_event, node) => onSelectNode(node.id);
  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    setHoveredNodeId(node.id);
  }, []);
  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Build set of edge-connected node IDs for the active (hovered or selected) node
  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const connectedEdgeIds = useMemo(() => {
    if (!activeNodeId) return null;
    const ids = new Set<string>();
    ids.add(activeNodeId);
    for (const edge of graph.edges) {
      if (edge.from === activeNodeId || edge.to === activeNodeId) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
  }, [activeNodeId, graph.edges]);

  const { flowNodes, flowEdges } = useMemo(() => {
    const typeOrder: NodeType[] = ["page", "action", "endpoint", "handler", "db"];
    const visibleNodes = graph.nodes.filter((node) => visibleNodeTypes.has(node.type));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const nodesByType = new Map<NodeType, typeof visibleNodes>(
      typeOrder.map((type) => [type, []]),
    );

    for (const node of visibleNodes) {
      nodesByType.get(node.type)?.push(node);
    }

    // Initial alphabetical sort as seed for the barycenter algorithm
    for (const nodes of nodesByType.values()) {
      nodes.sort((left, right) => left.label.localeCompare(right.label));
    }

    const activeTypeOrder = typeOrder.filter((type) => (nodesByType.get(type)?.length ?? 0) > 0);

    // Optimize node ordering to minimize edge crossings
    optimizeNodeOrder(nodesByType, activeTypeOrder, graph.edges, visibleNodeIds, visibleEdgeKinds);

    const flowNodes: FlowNode[] = [];
    const columnWidth = 300;
    const rowHeight = 80;

    activeTypeOrder.forEach((type, columnIndex) => {
      const nodes = nodesByType.get(type) ?? [];
      nodes.forEach((node, rowIndex) => {
        const isSelected = node.id === selectedNodeId;
        const status = nodeStatusById?.get(node.id) ?? "unchanged";
        const borderColor = isSelected ? "#1e293b" : DIFF_BORDER_COLOR[status];
        const borderStyle = status === "removed" ? "dashed" : "solid";

        flowNodes.push({
          id: node.id,
          data: { label: node.label },
          position: {
            x: 80 + columnIndex * columnWidth,
            y: 80 + rowIndex * rowHeight,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          selectable: true,
          style: {
            width: 200,
            borderRadius: 12,
            border: `2px ${borderStyle} ${borderColor}`,
            padding: "10px 14px",
            background: NODE_COLOR[node.type],
            color: node.type === "action" ? "#1e293b" : "#ffffff",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Inter', -apple-system, sans-serif",
            letterSpacing: "-0.01em",
            opacity: status === "removed" ? 0.65 : 1,
            boxShadow: isSelected
              ? `0 0 0 3px rgba(30, 41, 59, 0.15), 0 8px 24px rgba(0, 0, 0, 0.12)`
              : status === "added"
                ? `0 0 0 3px rgba(34, 197, 94, 0.2)`
                : status === "removed"
                  ? `0 0 0 3px rgba(239, 68, 68, 0.15)`
                  : `0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04)`,
            transition: "box-shadow 0.15s ease, border-color 0.15s ease",
          },
        });
      });
    });

    const flowEdges: FlowEdge[] = graph.edges
      .filter(
        (edge) =>
          visibleEdgeKinds.has(edge.kind) &&
          visibleNodeIds.has(edge.from) &&
          visibleNodeIds.has(edge.to),
      )
      .map((edge, index) => {
        const status = edgeStatusByKey?.get(buildEdgeKey(edge.from, edge.to, edge.kind)) ?? "unchanged";
        const strokeColor = status === "unchanged" ? EDGE_COLOR[edge.kind] : DIFF_EDGE_COLOR[status];

        // Determine if this edge is highlighted (connected to active node)
        const isHighlighted =
          activeNodeId !== null &&
          (edge.from === activeNodeId || edge.to === activeNodeId);
        const isDimmed = activeNodeId !== null && !isHighlighted;

        return {
          id: `${edge.from}=>${edge.to}::${edge.kind}::${index}`,
          source: edge.from,
          target: edge.to,
          animated: false,
          style: {
            stroke: strokeColor,
            strokeWidth: isHighlighted ? 2.5 : 1.5,
            strokeDasharray: status === "removed" ? "6 4" : undefined,
            opacity: isDimmed ? 0.08 : status === "removed" ? 0.6 : 0.85,
            transition: "opacity 0.15s ease, stroke-width 0.15s ease",
          },
          zIndex: isHighlighted ? 10 : 0,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: strokeColor,
          },
        };
      });

    return { flowNodes, flowEdges };
  }, [
    activeNodeId,
    edgeStatusByKey,
    graph,
    nodeStatusById,
    selectedNodeId,
    visibleEdgeKinds,
    visibleNodeTypes,
  ]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onPaneClick={() => onSelectNode(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e2e8f0" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const type = graph.nodes.find((graphNode) => graphNode.id === node.id)?.type;
            return type ? NODE_COLOR[type] : "#94a3b8";
          }}
          style={{
            borderRadius: 8,
            border: "1px solid rgba(148, 163, 184, 0.2)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.06)",
          }}
        />
        <Controls
          style={{
            borderRadius: 8,
            border: "1px solid rgba(148, 163, 184, 0.2)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.06)",
          }}
        />
      </ReactFlow>
    </div>
  );
}
