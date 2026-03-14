import { useMemo } from "react";
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
  ui: "#f97316",
  handler: "#14b8a6",
  action: "#fbbf24",
};

const NODE_BORDER: Record<NodeType, string> = {
  page: "#2563eb",
  endpoint: "#047857",
  db: "#b91c1c",
  ui: "#ea580c",
  handler: "#0d9488",
  action: "#f59e0b",
};

const EDGE_COLOR: Record<EdgeKind, string> = {
  "page-endpoint": "#06b6d4",
  "endpoint-db": "#f97316",
  "page-ui": "#8b5cf6",
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
  const handleNodeClick: NodeMouseHandler = (_event, node) => onSelectNode(node.id);

  const { flowNodes, flowEdges } = useMemo(() => {
    const typeOrder: NodeType[] = ["page", "action", "endpoint", "handler", "db", "ui"];
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

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        onNodeClick={handleNodeClick}
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
