import { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
  type NodeProps,
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

  const nodeRowIndex = new Map<string, number>();
  for (const type of activeTypeOrder) {
    const nodes = nodesByType.get(type) ?? [];
    nodes.forEach((node, i) => nodeRowIndex.set(node.id, i));
  }

  const ITERATIONS = 3;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let col = 1; col < activeTypeOrder.length; col++) {
      reorderColumn(activeTypeOrder[col], nodesByType, adjacency, nodeRowIndex);
    }
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
      barycenters.set(node.id, nodeRowIndex.get(node.id) ?? 0);
    }
  }

  nodes.sort((a, b) => (barycenters.get(a.id) ?? 0) - (barycenters.get(b.id) ?? 0));
  nodes.forEach((node, i) => nodeRowIndex.set(node.id, i));
}

function DescriptionLine({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <div
      style={{
        marginTop: 3,
        fontSize: 10,
        fontWeight: 400,
        opacity: 0.85,
        lineHeight: 1.3,
        color: dark ? "#1e293b" : "#ffffff",
      }}
    >
      {text}
    </div>
  );
}

function PageNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const screenshot = d.screenshot as string | undefined;
  const description = d.description as string | undefined;
  return (
    <div>
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {String(d.label ?? "")}
      </div>
      {description && <DescriptionLine text={description} />}
      {screenshot && (
        <img
          src={screenshot}
          alt=""
          style={{
            marginTop: 6,
            width: "100%",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.3)",
          }}
        />
      )}
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}

function DescribedNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>;
  const description = d.description as string | undefined;
  const dark = d.dark as boolean | undefined;
  return (
    <div>
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {String(d.label ?? "")}
      </div>
      {description && <DescriptionLine text={description} dark={dark} />}
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}

const nodeTypes = {
  pageNode: PageNode,
  describedNode: DescribedNode,
};

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
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeClick: NodeMouseHandler = (_event, node) => onSelectNode(node.id);

  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    // Debounce leave to prevent flicker from re-renders
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredNodeId(null);
      hoverTimeoutRef.current = null;
    }, 50);
  }, []);

  // Compute layout without hover state — this is the expensive part
  const { flowNodes: baseFlowNodes, flowEdges: baseFlowEdges } = useMemo(() => {
    const typeOrder: NodeType[] = ["page", "action", "endpoint", "handler", "db"];
    const visibleNodes = graph.nodes.filter((node) => visibleNodeTypes.has(node.type));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const nodesByType = new Map<NodeType, typeof visibleNodes>(
      typeOrder.map((type) => [type, []]),
    );

    for (const node of visibleNodes) {
      nodesByType.get(node.type)?.push(node);
    }

    for (const nodes of nodesByType.values()) {
      nodes.sort((left, right) => left.label.localeCompare(right.label));
    }

    const activeTypeOrder = typeOrder.filter((type) => (nodesByType.get(type)?.length ?? 0) > 0);
    optimizeNodeOrder(nodesByType, activeTypeOrder, graph.edges, visibleNodeIds, visibleEdgeKinds);

    const flowNodes: FlowNode[] = [];
    const columnWidth = 300;
    const defaultRowHeight = 80;
    const hasScreenshots = graph.nodes.some(
      (n) => n.type === "page" && n.meta?.screenshot,
    );
    const pageRowHeight = hasScreenshots ? 140 : defaultRowHeight;

    activeTypeOrder.forEach((type, columnIndex) => {
      const nodes = nodesByType.get(type) ?? [];
      const rowHeight = type === "page" ? pageRowHeight : defaultRowHeight;
      nodes.forEach((node, rowIndex) => {
        const isSelected = node.id === selectedNodeId;
        const status = nodeStatusById?.get(node.id) ?? "unchanged";
        const borderColor = isSelected ? "#1e293b" : DIFF_BORDER_COLOR[status];
        const borderStyle = status === "removed" ? "dashed" : "solid";
        const isPage = node.type === "page";
        const screenshot = isPage ? (node.meta?.screenshot as string | undefined) : undefined;
        const description = node.meta?.description as string | undefined;
        const isDarkText = node.type === "action";

        const nodeType = isPage
          ? "pageNode"
          : description
            ? "describedNode"
            : undefined;

        flowNodes.push({
          id: node.id,
          ...(nodeType ? { type: nodeType } : {}),
          data: {
            label: node.label,
            ...(screenshot ? { screenshot } : {}),
            ...(description ? { description } : {}),
            ...(isDarkText ? { dark: true } : {}),
          },
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
            transition: "opacity 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
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

        return {
          id: `${edge.from}=>${edge.to}::${edge.kind}::${index}`,
          source: edge.from,
          target: edge.to,
          animated: false,
          style: {
            stroke: strokeColor,
            strokeWidth: 1.5,
            strokeDasharray: status === "removed" ? "6 4" : undefined,
            opacity: status === "removed" ? 0.6 : 0.85,
            transition: "opacity 0.15s ease, stroke-width 0.15s ease",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: strokeColor,
          },
        };
      });

    return { flowNodes, flowEdges };
  }, [
    edgeStatusByKey,
    graph,
    nodeStatusById,
    selectedNodeId,
    visibleEdgeKinds,
    visibleNodeTypes,
  ]);

  // Apply hover highlighting as a cheap pass over precomputed nodes/edges
  const activeNodeId = hoveredNodeId ?? selectedNodeId;

  const connectedNodeIds = useMemo(() => {
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

  const flowNodes = useMemo(() => {
    if (!connectedNodeIds) return baseFlowNodes;
    return baseFlowNodes.map((node) => {
      const isDimmed = !connectedNodeIds.has(node.id);
      if (!isDimmed) return node;
      return {
        ...node,
        style: {
          ...node.style,
          opacity: 0.25,
        },
      };
    });
  }, [baseFlowNodes, connectedNodeIds]);

  const flowEdges = useMemo(() => {
    if (!activeNodeId) return baseFlowEdges;
    return baseFlowEdges.map((edge) => {
      const isHighlighted = edge.source === activeNodeId || edge.target === activeNodeId;
      const isDimmed = !isHighlighted;
      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: isHighlighted ? 2.5 : 1.5,
          opacity: isDimmed ? 0.08 : (edge.style?.opacity ?? 0.85),
        },
        zIndex: isHighlighted ? 10 : 0,
      };
    });
  }, [baseFlowEdges, activeNodeId]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
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
