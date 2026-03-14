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
  page: "#1d4ed8",
  endpoint: "#047857",
  db: "#b91c1c",
  ui: "#b45309",
  handler: "#0d9488",
  action: "#facc15",
};

const EDGE_COLOR: Record<EdgeKind, string> = {
  "page-endpoint": "#0891b2",
  "endpoint-db": "#ea580c",
  "page-ui": "#7c3aed",
  "endpoint-handler": "#22c55e",
  "page-action": "#facc15",
  "action-endpoint": "#a855f7",
};

const DIFF_BORDER_COLOR: Record<DiffStatus, string> = {
  added: "#22c55e",
  removed: "#ef4444",
  unchanged: "rgba(15, 23, 42, 0.18)",
};

const DIFF_EDGE_COLOR: Record<DiffStatus, string> = {
  added: "#22c55e",
  removed: "#ef4444",
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
    const columnWidth = 280;
    const rowHeight = 94;

    activeTypeOrder.forEach((type, columnIndex) => {
      const nodes = nodesByType.get(type) ?? [];
      nodes.forEach((node, rowIndex) => {
        const isSelected = node.id === selectedNodeId;
        const status = nodeStatusById?.get(node.id) ?? "unchanged";
        const borderColor = DIFF_BORDER_COLOR[status];
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
            width: 190,
            borderRadius: 10,
            border: `${isSelected ? 3 : 2}px ${borderStyle} ${isSelected ? "#111827" : borderColor}`,
            padding: 10,
            background: NODE_COLOR[node.type],
            color: node.type === "action" ? "#111827" : "#fff",
            fontSize: 12,
            fontWeight: 600,
            opacity: status === "removed" ? 0.78 : 1,
            boxShadow: isSelected
              ? "0 0 0 4px rgba(15, 23, 42, 0.12)"
              : status === "added"
                ? "0 0 0 3px rgba(34, 197, 94, 0.16)"
                : status === "removed"
                  ? "0 0 0 3px rgba(239, 68, 68, 0.12)"
              : "0 10px 30px rgba(15, 23, 42, 0.08)",
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
            strokeWidth: 1.75,
            strokeDasharray: status === "removed" ? "6 4" : undefined,
            opacity: status === "removed" ? 0.76 : 1,
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
    <div style={{ width: "100%", height: "100%" }}>
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
        <Background gap={18} size={1} color="#e5e7eb" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const type = graph.nodes.find((graphNode) => graphNode.id === node.id)?.type;
            return type ? NODE_COLOR[type] : "#94a3b8";
          }}
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
